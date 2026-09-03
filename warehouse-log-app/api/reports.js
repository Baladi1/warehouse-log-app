const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    const e = new Error("storage_not_configured");
    e.code = "storage_not_configured";
    throw e;
  }
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function hgetallToReports(flat) {
  const reports = [];
  if (!Array.isArray(flat)) return reports;
  for (let i = 0; i < flat.length; i += 2) {
    try {
      reports.push(JSON.parse(flat[i + 1]));
    } catch (e) {}
  }
  return reports;
}

module.exports = async function handler(req, res) {
  const MANAGER_PIN = process.env.MANAGER_PIN || "1234";

  try {
    if (req.method === "GET") {
      const { pin, inspector, date } = req.query;

      if (pin !== undefined) {
        if (pin !== MANAGER_PIN) {
          return res.status(403).json({ error: "bad_pin" });
        }
        const flat = await redis(["HGETALL", "reports"]);
        const reports = hgetallToReports(flat);
        reports.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        return res.status(200).json({ reports });
      }

      if (!inspector || !date) {
        return res.status(400).json({ error: "missing_params" });
      }
      const id = date + "__" + inspector;
      const val = await redis(["HGET", "reports", id]);
      return res.status(200).json({ report: val ? JSON.parse(val) : null });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const date = String(body.date || "");
      const inspector = String(body.inspector || "").trim().slice(0, 80);
      if (!DATE_RE.test(date) || !inspector) {
        return res.status(400).json({ error: "invalid_fields" });
      }
      const id = date + "__" + inspector;
      const report = Object.assign({}, body, {
        date: date,
        inspector: inspector,
        id: id,
        submittedAt: new Date().toISOString(),
      });
      await redis(["HSET", "reports", id, JSON.stringify(report)]);
      return res.status(200).json({ ok: true, report: report });
    }

    if (req.method === "DELETE") {
      const { id, pin } = req.query;
      if (pin !== MANAGER_PIN) {
        return res.status(403).json({ error: "bad_pin" });
      }
      if (!id) return res.status(400).json({ error: "missing_id" });
      await redis(["HDEL", "reports", id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    const code = err && err.code ? err.code : "server_error";
    return res.status(500).json({ error: code, message: String((err && err.message) || err) });
  }
};

