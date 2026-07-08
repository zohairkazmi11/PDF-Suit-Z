import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import postgres from "postgres";

const app = new Hono();

// Connect to your external free Postgres database (Neon / Supabase)
const connectionString = process.env.DATABASE_URL || "postgres://username:password@localhost:5432/database";
const sql = postgres(connectionString);

// Authentication Middleware
const authMiddleware = async (c, next) => {
  const sessionId = getCookie(c, "sessionId");
  if (!sessionId) return c.redirect("/login");

  const sessionResult = await sql`
    SELECT users.email, users.name 
    FROM sessions 
    JOIN users ON sessions.user_id = users.id 
    WHERE sessions.id = ${sessionId} AND sessions.expires_at > NOW()
  `;

  if (sessionResult.length === 0) {
    deleteCookie(c, "sessionId", { path: "/" });
    return c.redirect("/login");
  }

  c.set("user", sessionResult[0]);
  await next();
};

// Main Dashboard Page
app.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const userDocs = await sql`
    SELECT file_name, file_url FROM pdf_documents 
    WHERE user_email = ${user.email} 
    ORDER BY uploaded_at DESC
  `;

  let docListHtml = userDocs.length === 0 
    ? `<li class="doc-item" style="color: #94a3b8; pointer-events: none;">No documents uploaded yet.</li>`
    : userDocs.map((doc, i) => `
        <li class="doc-item ${i === 0 ? 'active' : ''}" onclick="window.location.href='/?file=${encodeURIComponent(doc.file_url)}'">
          ${doc.file_name}
        </li>`).join("");

  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>PDF Viewer Suite</title>
      <style>
        body { font-family: sans-serif; background: #f5f7fb; display: flex; height: 100vh; margin: 0; }
        .sidebar { width: 280px; background: #fff; border-right: 1px solid #e2e8f0; padding: 20px; }
        .doc-item { padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; margin-bottom: 8px; cursor: pointer; border-radius: 6px; }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <h1>PDF Suite</h1>
        <p>${user.name}</p>
        <a href="/logout">Sign Out</a>
        <form action="/upload" method="POST" enctype="multipart/form-data" id="uploadForm">
          <input type="file" name="pdf" onchange="document.getElementById('uploadForm').submit();" />
        </form>
        <ul>${docListHtml}</ul>
      </div>
    </body>
    </html>
  `);
});

// Auth Routes (Login/Signup)
app.get("/login", (c) => c.html(`
  <form action="/login" method="POST">
    <input type="email" name="email" required placeholder="Email" />
    <input type="password" name="password" required placeholder="Password" />
    <button type="submit">Sign In</button>
  </form>
`));

app.post("/login", async (c) => {
  const { email, password } = await c.req.parseBody();
  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (users.length > 0 && users[0].password === password) {
    const sessionId = Math.random().toString(36).slice(2);
    await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${sessionId}, ${users[0].id}, NOW() + INTERVAL '24 hours')`;
    setCookie(c, "sessionId", sessionId, { path: "/", httpOnly: true, secure: true });
    return c.redirect("/");
  }
  return c.redirect("/login?error=invalid");
});

app.post("/upload", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.pdf;
  if (file && file.name) {
    await sql`INSERT INTO pdf_documents (user_email, file_name, file_url) VALUES (${user.email}, ${file.name}, 'https://storage.url/${file.name}')`;
  }
  return c.redirect("/");
});

// THIS IS THE PART YOU WERE MISSING
const port = parseInt(process.env.PORT || "3000");
console.log(`Server running on port ${port}`);

serve({
  fetch: app.fetch,
  port: port,
  hostname: '0.0.0.0'
});
