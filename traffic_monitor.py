from ryu.base import app_manager
from ryu.controller import ofp_event
from ryu.controller.handler import CONFIG_DISPATCHER, MAIN_DISPATCHER, DEAD_DISPATCHER, set_ev_cls
from ryu.ofproto import ofproto_v1_3
from ryu.lib.packet import packet
from ryu.lib.packet import ethernet, ether_types
from ryu.lib.packet import ipv4, tcp, udp, icmp
from ryu.app.wsgi import ControllerBase, WSGIApplication, route
from webob import Response
import json
import time

class TrafficMonitor(app_manager.RyuApp):
    OFP_VERSIONS = [ofproto_v1_3.OFP_VERSION]  # 改为1.3
    _CONTEXTS = {'wsgi': WSGIApplication}

    def __init__(self, *args, **kwargs):
        super(TrafficMonitor, self).__init__(*args, **kwargs)
        self.datapaths = {}
        self.mac_to_port = {}
        self.flow_stats = {}
        self.port_stats = {}
        self.protocol_stats = {
            'http': {'packets': 0, 'bytes': 0},
            'https': {'packets': 0, 'bytes': 0},
            'ftp': {'packets': 0, 'bytes': 0},
            'smtp': {'packets': 0, 'bytes': 0},
            'pop3': {'packets': 0, 'bytes': 0},
            'imap': {'packets': 0, 'bytes': 0},
            'dns': {'packets': 0, 'bytes': 0},
            'other': {'packets': 0, 'bytes': 0}
        }
        self.stats_history = {
            'protocols': [],
            'timestamps': []
        }
        # 新增：用于存储数据包摘要的列表
        self.packet_summaries = []
        # 新增：限制存储的数据包摘要数量，防止内存爆炸
        self.MAX_PACKET_SUMMARIES = 1000
        wsgi = kwargs['wsgi']
        wsgi.register(TrafficMonitorRestApi, {'traffic_monitor': self})

    @set_ev_cls(ofp_event.EventOFPSwitchFeatures, CONFIG_DISPATCHER)
    def switch_features_handler(self, ev):
        datapath = ev.msg.datapath
        ofproto = datapath.ofproto
        parser = datapath.ofproto_parser

        match = parser.OFPMatch(
            eth_type=0x0800,  # IPv4
            ip_proto=6,       # TCP
            tcp_dst=80        # HTTP 端口
        )
        actions = [parser.OFPActionOutput(ofproto.OFPP_CONTROLLER)]
        self.add_flow(datapath, priority=10, match=match, actions=actions)


        # 安装table-miss流条目
        match = parser.OFPMatch()
        actions = [parser.OFPActionOutput(ofproto.OFPP_CONTROLLER,
                                        ofproto.OFPCML_NO_BUFFER)]
        inst = [parser.OFPInstructionActions(ofproto.OFPIT_APPLY_ACTIONS,
                                        actions)]
        mod = parser.OFPFlowMod(datapath=datapath, priority=0,
                            match=match, instructions=inst)
        datapath.send_msg(mod)

        self.datapaths[datapath.id] = datapath
        self.flow_stats[datapath.id] = []
        self.port_stats[datapath.id] = []

    def add_flow(self, datapath, priority, match, actions, buffer_id=None):
        ofproto = datapath.ofproto
        parser = datapath.ofproto_parser

        inst = [parser.OFPInstructionActions(ofproto.OFPIT_APPLY_ACTIONS,
                                        actions)]
        
        if buffer_id:
            mod = parser.OFPFlowMod(datapath=datapath, buffer_id=buffer_id,
                                priority=priority, match=match,
                                instructions=inst)
        else:
            mod = parser.OFPFlowMod(datapath=datapath, priority=priority,
                                match=match, instructions=inst)
        datapath.send_msg(mod)

    @set_ev_cls(ofp_event.EventOFPPacketIn, MAIN_DISPATCHER)
    def _packet_in_handler(self, ev):
        msg = ev.msg
        datapath = msg.datapath
        ofproto = datapath.ofproto
        parser = datapath.ofproto_parser
        in_port = msg.match['in_port']
        
        pkt = packet.Packet(msg.data)
        eth_pkt = pkt.get_protocol(ethernet.ethernet)

        # ====== 新增：过滤 IPv6 数据包 ======
        if eth_pkt and eth_pkt.ethertype == ether_types.ETH_TYPE_IPV6:
            # 如果是以太网帧且类型是 IPv6，则直接转发并跳过摘要和统计更新
            actions = [parser.OFPActionOutput(ofproto.OFPP_NORMAL)]
            out = parser.OFPPacketOut(
                datapath=datapath,
                buffer_id=msg.buffer_id,
                in_port=msg.match['in_port'],
                actions=actions,
                data=msg.data if msg.buffer_id == ofproto.OFP_NO_BUFFER else None
            )
            datapath.send_msg(out)
            return # 退出处理函数，不进行后续处理
        # ==================================
        
       
        if eth_pkt: # 确保是以太网帧
            dpid = datapath.id
            src_mac = eth_pkt.src
            dst_mac = eth_pkt.dst
            
            self.mac_to_port.setdefault(dpid, {})

        # 学习源 MAC 地址
            self.mac_to_port[dpid][src_mac] = in_port
            self.logger.info("学习到交换机 %s 的 MAC: %s -> 端口: %s", dpid, src_mac, in_port)

        protocol = self._identify_protocol(pkt) # 协议识别

        self._update_protocol_stats(protocol, len(msg.data))  # 更新统计
        # 新增：生成数据包摘要并存储
        self._generate_and_store_packet_summary(datapath, pkt, in_port, msg.data)
        
        # 优先尝试基于学习到的MAC地址进行转发
        out_port = ofproto.OFPP_FLOOD # 默认泛洪
        if eth_pkt and eth_pkt.dst in self.mac_to_port.get(datapath.id, {}):
            out_port = self.mac_to_port[datapath.id][eth_pkt.dst]
            self.logger.info("数据包转发到已知MAC %s -> 端口 %s", eth_pkt.dst, out_port)
        else:
            self.logger.info("数据包泛洪 (目的MAC未知): %s", eth_pkt.dst if eth_pkt else "N/A")

        # 直接转发，不安装流表（确保所有流量都上报控制器）
        actions = [parser.OFPActionOutput(ofproto.OFPP_NORMAL)]  # 或 OFPP_FLOOD
        out = parser.OFPPacketOut(
            datapath=datapath,
            buffer_id=msg.buffer_id,
            in_port=msg.match['in_port'],
            actions=actions,
            data=msg.data if msg.buffer_id == ofproto.OFP_NO_BUFFER else None
        )
        datapath.send_msg(out)
    # 新增：生成并存储数据包摘要的方法
    def _generate_and_store_packet_summary(self, datapath, pkt, in_port, raw_data):
        summary = {
            'timestamp': time.time(),
            'dpid': datapath.id,
            'in_port': in_port,
            'eth_src': None,
            'eth_dst': None,
            'eth_type': None,
            'ip_src': None,
            'ip_dst': None,
            'ip_proto': None,
            'src_port': None,
            'dst_port': None,
            'packet_len': len(raw_data),
            'protocol_identified': self._identify_protocol(pkt)
        }

        # 提取以太网信息
        eth_pkt = pkt.get_protocol(ethernet.ethernet)
        if eth_pkt:
            summary['eth_src'] = eth_pkt.src
            summary['eth_dst'] = eth_pkt.dst
            summary['eth_type'] = hex(eth_pkt.ethertype) # 转换为十六进制字符串

        # 提取 IP 和传输层信息
        ip_pkt = pkt.get_protocol(ipv4.ipv4)
        if ip_pkt:
            summary['ip_src'] = ip_pkt.src
            summary['ip_dst'] = ip_pkt.dst
            summary['ip_proto'] = ip_pkt.proto # 协议号

            tcp_pkt = pkt.get_protocol(tcp.tcp)
            udp_pkt = pkt.get_protocol(udp.udp)

            if tcp_pkt:
                summary['src_port'] = tcp_pkt.src_port
                summary['dst_port'] = tcp_pkt.dst_port
            elif udp_pkt:
                summary['src_port'] = udp_pkt.src_port
                summary['dst_port'] = udp_pkt.dst_port

        # 限制摘要数量，移除最旧的
        if len(self.packet_summaries) >= self.MAX_PACKET_SUMMARIES:
            self.packet_summaries.pop(0) # 移除列表最开头的（最旧的）
        self.packet_summaries.append(summary) # 添加新的摘要
        
    def _identify_protocol(self, pkt):
        """Identify protocol type from packet"""
        ip_pkt = pkt.get_protocol(ipv4.ipv4)
        tcp_pkt = pkt.get_protocol(tcp.tcp)
        udp_pkt = pkt.get_protocol(udp.udp)
        icmp_pkt = pkt.get_protocol(icmp.icmp)
	
        if not ip_pkt:
            return 'other'
        
        # TCP protocols
        if tcp_pkt:
            dst_port = tcp_pkt.dst_port
            src_port = tcp_pkt.src_port
            print('dst_port: ', dst_port)
            print('src_port: ', src_port)
            
            # HTTP (80) or HTTPS (443)
            if dst_port == 80 or src_port == 80:
                return 'http'
            elif dst_port == 443 or src_port == 443:
                return 'https'
            # FTP (21 - control, 20 - data)
            elif dst_port == 21 or src_port == 21:
                return 'ftp'
            # SMTP (25)
            elif dst_port == 25 or src_port == 25:
                return 'smtp'
            # POP3 (110)
            elif dst_port == 110 or src_port == 110:
                return 'pop3'
            # IMAP (143)
            elif dst_port == 143 or src_port == 143:
                return 'imap'
            # SSH (22)
            elif dst_port == 22 or src_port == 22:
                return 'ssh'
        
        # UDP protocols
        if udp_pkt:
            dst_port = udp_pkt.dst_port
            src_port = udp_pkt.src_port
            
            # DNS (53)
            if dst_port == 53 or src_port == 53:
                return 'dns'
            # DHCP (67, 68)
            elif dst_port == 67 or src_port == 67 or dst_port == 68 or src_port == 68:
                return 'dhcp'
        
        if icmp_pkt:
            return 'icmp'
        
        return 'other'

    def _update_protocol_stats(self, protocol, packet_size):
        """Update protocol statistics"""
        if protocol in self.protocol_stats:
            self.protocol_stats[protocol]['packets'] += 1
            self.protocol_stats[protocol]['bytes'] += packet_size
        else:
            self.protocol_stats['other']['packets'] += 1
            self.protocol_stats['other']['bytes'] += packet_size
        
        # Record history every 10 seconds
        current_time = int(time.time())
        if not self.stats_history['timestamps'] or current_time - self.stats_history['timestamps'][-1] >= 10:
            self.stats_history['timestamps'].append(current_time)
            self.stats_history['protocols'].append(self.protocol_stats.copy())

    def send_stats_request(self, datapath):
        ofproto = datapath.ofproto
        parser = datapath.ofproto_parser

        req = parser.OFPFlowStatsRequest(datapath)
        datapath.send_msg(req)

        # 修复2：将OFPP_NONE改为OFPP_ANY
        req = parser.OFPPortStatsRequest(datapath, 0, ofproto.OFPP_ANY)
        datapath.send_msg(req)


    def start_periodic_stats_request(self):
        import threading

        def periodic_stats_request():
            while True:
                for dp in self.datapaths.values():
                    self.send_stats_request(dp)
                threading.Event().wait(10)

        threading.Thread(target=periodic_stats_request).start()

    @set_ev_cls(ofp_event.EventOFPFlowStatsReply, MAIN_DISPATCHER)
    def _flow_stats_reply_handler(self, ev):
        body = ev.msg.body
        datapath = ev.msg.datapath
        dpid = datapath.id
        
        self.flow_stats[dpid] = []
        for stat in body:
            flow_info = {
                'table_id': stat.table_id,
                'match': str(stat.match),
                'duration': stat.duration_sec,
                'packets': stat.packet_count,
                'bytes': stat.byte_count,
                'protocol': self._identify_flow_protocol(stat)
            }
            self.flow_stats[dpid].append(flow_info)

    def _identify_flow_protocol(self, flow_stat):
        """Identify protocol from flow stats"""
        match_str = str(flow_stat.match)
        
        # TCP protocols
        if 'tp_dst=80' in match_str or 'tp_src=80' in match_str:
            return 'http'
        elif 'tp_dst=443' in match_str or 'tp_src=443' in match_str:
            return 'https'
        elif 'tp_dst=21' in match_str or 'tp_src=21' in match_str:
            return 'ftp'
        elif 'tp_dst=25' in match_str or 'tp_src=25' in match_str:
            return 'smtp'
        elif 'tp_dst=110' in match_str or 'tp_src=110' in match_str:
            return 'pop3'
        elif 'tp_dst=143' in match_str or 'tp_src=143' in match_str:
            return 'imap'
        elif 'tp_dst=22' in match_str or 'tp_src=22' in match_str:
            return 'ssh'
        
        # UDP protocols
        elif 'tp_dst=53' in match_str or 'tp_src=53' in match_str:
            return 'dns'
        elif 'tp_dst=67' in match_str or 'tp_src=67' in match_str or 'tp_dst=68' in match_str or 'tp_src=68' in match_str:
            return 'dhcp'
        
        return 'other'

    @set_ev_cls(ofp_event.EventOFPPortStatsReply, MAIN_DISPATCHER)
    def _port_stats_reply_handler(self, ev):
        body = ev.msg.body
        datapath = ev.msg.datapath
        dpid = datapath.id
        
        self.port_stats[dpid] = []
        for stat in body:
            port_info = {
                'port_no': stat.port_no,
                'rx_packets': stat.rx_packets,
                'tx_packets': stat.tx_packets,
                'rx_bytes': stat.rx_bytes,
                'tx_bytes': stat.tx_bytes,
                'rx_errors': stat.rx_errors,
                'tx_errors': stat.tx_errors
            }
            self.port_stats[dpid].append(port_info)

    @set_ev_cls(ofp_event.EventOFPErrorMsg, [MAIN_DISPATCHER, CONFIG_DISPATCHER])
    def error_msg_handler(self, ev):
        msg = ev.msg
        if msg.version == ofproto_v1_3.OFP_VERSION:
            # OpenFlow 1.3的错误处理
            if msg.type == ofproto_v1_3.OFPET_EXPERIMENTER:
                pass  # 处理experimenter错误
        else:
            # 其他版本处理
            self.logger.error("OFPErrorMsg received: %s", msg)

    def start(self):
        super(TrafficMonitor, self).start()
        self.start_periodic_stats_request()


class TrafficMonitorRestApi(ControllerBase):
    def __init__(self, req, link, data, **config):
        super(TrafficMonitorRestApi, self).__init__(req, link, data, **config)
        self.traffic_monitor_app = data['traffic_monitor']

    @route('traffic_monitor', '/stats/flow/{dpid}', methods=['GET'])
    def list_flow_stats(self, req, dpid, **_kwargs):
        try:
            dpid = int(dpid)
            if dpid not in self.traffic_monitor_app.datapaths:
                return Response(status=404)

            datapath = self.traffic_monitor_app.datapaths[dpid]
            self.traffic_monitor_app.send_stats_request(datapath)
            
            return Response(
                content_type='application/json',
                body=json.dumps({
                    'success': True,
                    'flows': self.traffic_monitor_app.flow_stats.get(dpid, [])
                })
            )
        except ValueError:
            return Response(status=400)

    @route('traffic_monitor', '/stats/port/{dpid}', methods=['GET'])
    def list_port_stats(self, req, dpid, **_kwargs):
        try:
            dpid = int(dpid)
            if dpid not in self.traffic_monitor_app.datapaths:
                return Response(status=404)

            datapath = self.traffic_monitor_app.datapaths[dpid]
            self.traffic_monitor_app.send_stats_request(datapath)
            
            return Response(
                content_type='application/json',
                body=json.dumps({
                    'success': True,
                    'ports': self.traffic_monitor_app.port_stats.get(dpid, [])
                })
            )
        except ValueError:
            return Response(status=400)

    @route('traffic_monitor', '/stats/protocol', methods=['GET'])
    def list_protocol_stats(self, req, **_kwargs):
        """获取协议分类统计"""
        try:
            body = json.dumps({
                'success': True,
                'protocols': self.traffic_monitor_app.protocol_stats,
                'history': {
                    'timestamps': self.traffic_monitor_app.stats_history['timestamps'],
                    'protocols': self.traffic_monitor_app.stats_history['protocols']
                }
            })
            return Response(
                content_type='application/json; charset=utf-8',
                body=body
            )
        except Exception as e:
            return Response(
                content_type='text/plain; charset=utf-8',
                status=500,
                body=str(e)
            )
    # 新增：获取数据包摘要的 REST API 端点
    @route('traffic_monitor', '/stats/packet_summaries', methods=['GET'])
    def list_packet_summaries(self, req, **_kwargs):
        """获取数据包摘要列表"""
        try:
            # 可以通过请求参数控制返回的摘要数量，例如 /stats/packet_summaries?limit=50
            limit = int(req.GET.get('limit', self.traffic_monitor_app.MAX_PACKET_SUMMARIES))
            # 返回最新的N个数据包摘要
            summaries_to_send = self.traffic_monitor_app.packet_summaries[-limit:] if limit > 0 else []

            body = json.dumps({
                'success': True,
                'packet_summaries': summaries_to_send
            })
            return Response(
                content_type='application/json; charset=utf-8',
                body=body
            )
        except Exception as e:
            return Response(
                content_type='text/plain; charset=utf-8',
                status=500,
                body=str(e)
            )

    @route('traffic_monitor', '/stats/clear', methods=['POST'])
    def clear_stats(self, req, **_kwargs):
        """Clear all statistics"""
        try:
            # Reset protocol stats
            for proto in self.traffic_monitor_app.protocol_stats:
                self.traffic_monitor_app.protocol_stats[proto]['packets'] = 0
                self.traffic_monitor_app.protocol_stats[proto]['bytes'] = 0
            
            # Reset history
            self.traffic_monitor_app.stats_history = {
                'protocols': [],
                'timestamps': []
            }
            # 新增：清空数据包摘要
            self.traffic_monitor_app.packet_summaries = []
            
            return Response(
                content_type='application/json',
                body=json.dumps({'success': True})
            )
        except Exception as e:
            return Response(status=500, body=str(e))
        
    @route('traffic_monitor', '/stats/switch', methods=['GET'])
    def list_switches(self, req, **_kwargs):
        """获取连接的交换机列表"""
        try:
            switches = [
                {'dpid': dpid, 'ports': len(self.traffic_monitor_app.port_stats.get(dpid, []))}
                for dpid in self.traffic_monitor_app.datapaths
            ]
            return Response(
                content_type='application/json; charset=utf-8',
                body=json.dumps({
                    'success': True,
                    'switches': switches
                })
            )
        except Exception as e:
            return Response(status=500, body=str(e))
