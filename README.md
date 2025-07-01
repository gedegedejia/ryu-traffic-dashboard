# SDN 流量审计与可视化系统

基于 Ryu 控制器的 SDN 网络流量监控与安全审计系统，提供实时流量分析和可视化功能。

## 📜 目录
- [环境部署](#-环境部署)
  - [安装依赖](#安装依赖)
  - [文件部署](#文件部署)
- [运行指南](#-运行指南)
- [拓扑测试](#-拓扑测试)
  - [FTP 服务测试](#1-ftp-服务测试)
  - [Web 服务测试](#2-web-服务测试)
  - [Mail 服务测试](#3-mail-服务测试)
- [可视化界面](#️-可视化界面)

---

## 📦 环境部署

### 安装依赖
```bash
# 基础依赖
sudo apt-get install -y python3-pip mininet openvswitch-switch

# Python 依赖
pip install ryu==4.34 mininet==2.3.0

# 前端依赖
cd ryu_project/frontend && npm install
```

### 文件部署
```bash
# 自动部署
cp -r ryu_project/ ~/ryu/ryu/app/
cp traffic_monitor.py ~/ryu/ryu/app/

# 或手动部署：
1. 将 `ryu_project` 放在 `ryu/ryu/app/` 目录下
2. 将 `traffic_monitor.py` 放在 `ryu/ryu/app/`
```

---

## 🚀 运行指南
```bash
# 终端1：启动 Ryu 控制器
cd ~/ryu/ryu/app
ryu-manager --verbose ofctl_rest.py rest_topology.py traffic_monitor.py --observe-links

# 终端2：启动 Mininet 拓扑
cd ~/ryu/ryu/app/ryu_project
sudo python3 topo.py

# 终端3：启动前端界面
cd ~/ryu/ryu/app/ryu_project/frontend
npm run dev
```

---

## 🔍 拓扑测试

### 1. FTP 服务测试
```bash
h2 nc -zv ftp 21
```
✅ 预期输出：  
`Connection to 10.0.0.4 21 port [tcp/ftp] succeeded!`

### 2. Web 服务测试
```bash
# 方法1：直接访问IP
h1 curl http://10.0.0.3

# 方法2：添加主机名后访问
mininet> h1 bash
echo "10.0.0.3 web" >> /etc/hosts
exit
h1 curl http://web
```
✅ 预期输出：Web 服务器文件列表

### 3. Mail 服务测试
```bash
# 端口测试
h2 nc -zv mail 25

# 发送测试邮件
h2 telnet mail 25
```
输入以下内容：
```
EHLO example.com
MAIL FROM: <user@example.com>
RCPT TO: <recipient@example.com>
DATA
Subject: Test Email
This is a test email.
.
QUIT
```
✅ 预期结果：
- 每步返回 `250 OK`
- 邮件内容保存在 `/tmp/mail.log`

---

## 🖥️ 可视化界面
访问 `http://localhost:3000` 查看实时监控面板
