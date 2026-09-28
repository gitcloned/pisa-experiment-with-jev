import { getUsers, initDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  let users: Awaited<ReturnType<typeof getUsers>> = [];
  let error: string | null = null;

  try {
    await initDb();
    users = await getUsers();
  } catch (e) {
    console.error("[analytics]", e);
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">User Analytics</h1>
            <p className="text-sm text-gray-400 mt-0.5">{users.length} user{users.length !== 1 ? "s" : ""} total</p>
          </div>
          <a
            href="/api/analytics"
            target="_blank"
            className="text-xs text-blue-600 hover:underline"
          >
            Raw JSON
          </a>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 font-mono break-all">
            <p className="font-semibold mb-1">DB error</p>
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">Email</th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">Name</th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">Visits</th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">First seen</th>
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.email} className={`border-b border-gray-50 last:border-0 ${i % 2 === 1 ? "bg-gray-50/50" : ""}`}>
                    <td className="px-4 py-3 text-gray-800 font-medium">{u.email}</td>
                    <td className="px-4 py-3 text-gray-500">{u.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold rounded-full px-2 py-0.5">
                        {u.visit_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(u.first_seen).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(u.last_seen).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-300 text-sm">No users yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
