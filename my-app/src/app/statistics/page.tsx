"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import Chart from "chart.js/auto";

interface ProtocolStats {
  packets: number;
  bytes: number;
}
interface ProtocolData {
  [key: string]: ProtocolStats;
}
interface HistoryRecord {
  timestamp: number;
  data: ProtocolData;
}
interface PacketSummary {
  timestamp: number;
  dpid: number;
  in_port: number;
  eth_src: string;
  eth_dst: string;
  eth_type: string;
  ip_src: string | null;
  ip_dst: string | null;
  ip_proto: number | null;
  src_port: number | null;
  dst_port: number | null;
  packet_len: number;
  protocol_identified: string;
}

type TimeRange = "5m" | "15m" | "30m" | "1h";

const pageSize = 10;
const HISTORY_LIMIT = 120; // 最多保存120个点
const LOCAL_HISTORY_KEY = 'traffic_history';

export default function Statistics() {
  // 状态
  const [protocolData, setProtocolData] = useState<ProtocolData>({});
  const [localHistory, setLocalHistory] = useState<HistoryRecord[]>([]);
  const [packetSummaries, setPacketSummaries] = useState<PacketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("15m");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPackets, setTotalPackets] = useState(0);
  const lineChartRef = useRef<HTMLCanvasElement | null>(null);
  const pieChartRef = useRef<HTMLCanvasElement | null>(null);
  const lineChartInstance = useRef<Chart | null>(null);
  const pieChartInstance = useRef<Chart | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 页面加载时，先从 localStorage 恢复历史
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_HISTORY_KEY);
      if (saved) {
        const parsed: HistoryRecord[] = JSON.parse(saved);
        setLocalHistory(parsed);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // 定时采样协议统计数据
  const fetchProtocolStats = async () => {
    try {
      const res = await fetch("/api/stats/protocol");
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setProtocolData(data.protocols);
      // 采样快照
      setLocalHistory((prev) => {
        const now = Math.floor(Date.now() / 1000);
        const newHistory = [
          ...prev,
          { timestamp: now, data: { ...data.protocols } },
        ];
        // 只保留最近 HISTORY_LIMIT 个点
        const trimmed = newHistory.length > HISTORY_LIMIT
          ? newHistory.slice(newHistory.length - HISTORY_LIMIT)
          : newHistory;
        // 持久化到 localStorage
        try {
          localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(trimmed));
        } catch (e) {
          // ignore
        }
        return trimmed;
      });
    } catch (e) {
      setError("数据获取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProtocolStats();
    // eslint-disable-next-line
  }, []);

  // 获取全部数据包摘要
  const fetchPacketSummaries = async () => {
    const packetRes = await fetch("/api/stats/packet_summaries");
    if (!packetRes.ok) throw new Error("Packet summaries API error");
    const packetData = await packetRes.json();
    setPacketSummaries(packetData.packet_summaries || []);
  };

  useEffect(() => {
    fetchPacketSummaries();
    // eslint-disable-next-line
  }, []);

  // 过滤协议
  const filteredProtocols = useMemo(() => {
    const { dns, other, ...rest } = protocolData;
    return rest;
  }, [protocolData]);

  // 过滤历史
  const filteredHistory = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let seconds = 900;
    if (timeRange === "5m") seconds = 300;
    if (timeRange === "30m") seconds = 1800;
    if (timeRange === "1h") seconds = 3600;
    return localHistory.filter((r) => r.timestamp >= now - seconds);
  }, [localHistory, timeRange]);

  // 格式化函数
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };
  const formatPacketTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  // 协议颜色
  const getProtocolColor = (protocol: string, opacity = 1) => {
    const colors: Record<string, string> = {
      http: `rgba(75, 192, 192, ${opacity})`,
      https: `rgba(54, 162, 235, ${opacity})`,
      ftp: `rgba(255, 159, 64, ${opacity})`,
      smtp: `rgba(153, 102, 255, ${opacity})`,
      pop3: `rgba(255, 99, 132, ${opacity})`,
      imap: `rgba(255, 205, 86, ${opacity})`,
    };
    return colors[protocol] || `rgba(199, 199, 199, ${opacity})`;
  };

  // 图表渲染
  useEffect(() => {
    if (!lineChartRef.current) return;
    if (lineChartInstance.current) lineChartInstance.current.destroy();
    const protocols = Object.keys(filteredProtocols);
    lineChartInstance.current = new Chart(lineChartRef.current, {
      type: "line",
      data: {
        labels: filteredHistory.map((r) => formatPacketTime(r.timestamp)),
        datasets: protocols.map((protocol) => ({
          label: protocol,
          data: filteredHistory.map((r) => r.data[protocol]?.bytes || 0),
          borderColor: getProtocolColor(protocol),
          backgroundColor: getProtocolColor(protocol, 0.1),
          tension: 0.1,
          fill: true,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (context: any) => {
                const label = context.dataset.label || "";
                const value = context.raw as number;
                return `${label}: ${formatBytes(value)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    });
    // eslint-disable-next-line
  }, [filteredProtocols, filteredHistory]);

  useEffect(() => {
    if (!pieChartRef.current) return;
    if (pieChartInstance.current) pieChartInstance.current.destroy();
    const protocols = Object.keys(filteredProtocols);
    const total = Object.values(filteredProtocols).reduce((sum, s) => sum + s.bytes, 0);
    pieChartInstance.current = new Chart(pieChartRef.current, {
      type: "pie",
      data: {
        labels: protocols,
        datasets: [
          {
            data: protocols.map((p) => filteredProtocols[p].bytes),
            backgroundColor: protocols.map((p) => getProtocolColor(p, 0.7)),
          },
        ],
      },
      options: {
        plugins: {
          tooltip: {
            callbacks: {
              label: (context: any) => {
                const label = context.label || "";
                const value = context.raw as number;
                const percent = total ? ((value / total) * 100).toFixed(2) : 0;
                return `${label}: ${formatBytes(value)} (${percent}%)`;
              },
            },
          },
        },
      },
    });
    // eslint-disable-next-line
  }, [filteredProtocols]);

  // 前端分页
  const totalPages = Math.max(1, Math.ceil(packetSummaries.length / pageSize));
  const currentPageData = useMemo(
    () => packetSummaries.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [packetSummaries, currentPage]
  );
  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };
  const handleRefresh = () => fetchProtocolStats();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-3xl font-bold mb-8 text-center">流量监控</h1>
      <div className="flex justify-end max-w-6xl mx-auto mb-4">
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-center">{error}</div>
      )}
      {/* 实时协议统计 */}
      <div className="max-w-6xl mx-auto bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">实时协议统计</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(filteredProtocols).map(([protocol, stats]) => (
            <div key={protocol} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
              <h3 className="font-medium capitalize">{protocol}</h3>
              <div className="mt-2 text-sm text-gray-600">
                <p>数据包: {stats.packets.toLocaleString()}</p>
                <p>流量: {formatBytes(stats.bytes)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 图表区域 */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 历史流量趋势 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">历史流量趋势</h2>
          <div className="h-64">
            <canvas ref={lineChartRef}></canvas>
          </div>
        </div>
        {/* 流量占比饼图 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">流量占比分布</h2>
          <div className="h-64">
            <canvas ref={pieChartRef}></canvas>
          </div>
        </div>
      </div>
      {/* 最新数据包摘要表格 */}
      <div className="max-w-6xl mx-auto bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">最新数据包摘要</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">时间</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">交换机</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">入端口</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">源MAC</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">目的MAC</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">源IP</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">目的IP</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">源端口</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">目的端口</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">协议</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">长度</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {currentPageData.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    暂无数据包摘要。请确保流量正在通过网络。
                  </td>
                </tr>
              ) : (
                currentPageData.map((packet, idx) => (
                  <tr key={idx} style={{ backgroundColor: getProtocolColor(packet.protocol_identified, 0.05) }}>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-800">{formatPacketTime(packet.timestamp)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{packet.dpid}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{packet.in_port}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-800">{packet.eth_src || 'N/A'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-800">{packet.eth_dst || 'N/A'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{packet.ip_src || 'N/A'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{packet.ip_dst || 'N/A'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{packet.src_port || 'N/A'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{packet.dst_port || 'N/A'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm font-medium capitalize">{packet.protocol_identified || 'N/A'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{formatBytes(packet.packet_len)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* 分页控件 */}
        <div className="flex justify-center mt-4 gap-2">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >上一页</button>
          <span className="px-2">第 {currentPage} / {totalPages} 页</span>
          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >下一页</button>
        </div>
      </div>
    </div>
  );
} 