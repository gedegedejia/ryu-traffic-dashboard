"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Switches() {
  const [switches, setSwitches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchSwitches = async () => {
      try {
        const response = await fetch("/api/stats/switches");
        if (!response.ok) throw new Error("获取交换机列表失败");
        const data = await response.json();
        setSwitches(data);
      } catch (e) {
        setError("获取交换机列表失败，请确保RYU控制器正在运行");
        console.error("API请求错误:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchSwitches();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">网络交换机</h1>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex justify-center items-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {switches.map((switchId) => (
              <div
                key={switchId}
                className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
              >
                <h2 className="text-xl font-semibold mb-2">交换机 {switchId}</h2>
                <Link
                  href={`/switches/${switchId}`}
                  className="inline-block mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  查看详情
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
} 