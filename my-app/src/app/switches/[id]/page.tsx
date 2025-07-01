"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";

interface Flow {
  match: Record<string, any>;
  actions: string;
  priority: number;
  idle_timeout: number;
  hard_timeout: number;
}

export default function SwitchDetail({ params }: { params: { id: string } }) {
  const { id } = use(params);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [description, setDescription] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flowForm, setFlowForm] = useState({
    cookie: "",
    priority: 0,
    match: {
      in_port: "",
      eth_dst: "",
    },
  });

  const fetchSwitchData = async () => {
    setLoading(true);
    setError("");
    try {
      const [flowRes, descRes] = await Promise.all([
        fetch(`/api/stats/flow/${id}`),
        fetch(`/api/stats/desc/${id}`),
      ]);
      if (!flowRes.ok || !descRes.ok) throw new Error("Failed to fetch switch data");
      const flowData = await flowRes.json();
      const descData = await descRes.json();
      setFlows(flowData[id] || []);
      setDescription(descData[id] || {});
    } catch (e) {
      setError("Failed to fetch switch data. Please make sure the RYU controller is running.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSwitchData();
    // eslint-disable-next-line
  }, [id]);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name.startsWith("match.")) {
      setFlowForm((prev) => ({
        ...prev,
        match: { ...prev.match, [name.replace("match.", "")]: value },
      }));
    } else {
      setFlowForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const response = await fetch(`/api/stats/flowentry/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dpid: id,
          cookie: flowForm.cookie,
          priority: flowForm.priority,
          match: flowForm.match,
          actions: [],
        }),
      });
      if (!response.ok) throw new Error("Failed to add flow entry");
      await fetchSwitchData();
      setFlowForm({ cookie: "", priority: 0, match: { in_port: "", eth_dst: "" } });
    } catch (e) {
      setError("Failed to add flow entry");
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/switches" className="text-blue-500 hover:text-blue-700">
            ← Back to Switches
          </Link>
        </div>
        <h1 className="text-3xl font-bold mb-8">Switch {id}</h1>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
        )}
        {loading ? (
          <div className="flex justify-center items-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <>
            {/* Switch Description */}
            <div className="bg-white p-6 rounded-lg shadow-md mb-6">
              <h2 className="text-xl font-semibold mb-4">Switch Description</h2>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(description).map(([key, value]) => (
                  <div className="p-2" key={key}>
                    <span className="font-medium">{key}:</span>
                    <span className="ml-2">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Flow Table */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-semibold mb-4">Flow Table</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Match</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timeouts</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {flows.map((flow, idx) => (
                      <tr key={idx}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {Object.entries(flow.match).map(([k, v]) => (
                            <div key={k}>
                              {k}: {String(v)}
                            </div>
                          ))}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">{flow.actions}</td>
                        <td className="px-6 py-4 whitespace-nowrap">{flow.priority}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>Idle: {flow.idle_timeout}</div>
                          <div>Hard: {flow.hard_timeout}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Add Flow Form */}
            <div className="bg-white p-6 rounded-lg shadow-md mt-6">
              <h2 className="text-xl font-semibold mb-4">Add Flow Entry</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Cookie</label>
                    <input
                      name="cookie"
                      value={flowForm.cookie}
                      onChange={handleFormChange}
                      type="text"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Priority</label>
                    <input
                      name="priority"
                      value={flowForm.priority}
                      onChange={handleFormChange}
                      type="number"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Match In Port</label>
                    <input
                      name="match.in_port"
                      value={flowForm.match.in_port}
                      onChange={handleFormChange}
                      type="number"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Match Eth Dst</label>
                    <input
                      name="match.eth_dst"
                      value={flowForm.match.eth_dst}
                      onChange={handleFormChange}
                      type="text"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Add Flow
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
} 