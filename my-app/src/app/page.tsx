import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-center mb-8">RYU Controller Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link href="/switches" className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
            <h2 className="text-xl font-semibold mb-2">交换机管理</h2>
            <p className="text-gray-600">View and manage network switches</p>
          </Link>
          <Link href="/topology" className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
            <h2 className="text-xl font-semibold mb-2">网络拓扑</h2>
            <p className="text-gray-600">View network topology and connections</p>
          </Link>
          <Link href="/statistics" className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow">
            <h2 className="text-xl font-semibold mb-2">流量审计</h2>
            <p className="text-gray-600">View network statistics and monitoring</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
