import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import postgres from "postgres";

const app = new Hono();

// Connect to your external Postgres database
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
    ? `<div class="p-4 text-gray-400 text-sm italic">No documents uploaded yet.</div>`
    : userDocs.map((doc, i) => `
        <div class="p-3 bg-white border border-gray-200 rounded-lg cursor-pointer hover:border-indigo-400 transition shadow-sm" 
             onclick="window.location.href='/?file=${encodeURIComponent(doc.file_url)}'">
          <div class="font-medium text-gray-700">${doc.file_name}</div>
        </div>`).join("");

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>PDF Viewer Suite</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50 flex h-screen">
      <aside class="w-72 bg-white border-r border-gray-200 p-6 flex flex-col">
        <h1 class="text-xl font-bold text-indigo-600 mb-6">PDF Suite</h1>
        <div class="mb-6">
          <p class="text-sm text-gray-500">Welcome back,</p>
          <p class="font-semibold text-gray-800">${user.name}</p>
        </div>
        <form action="/upload" method="POST" enctype="multipart/form-data" id="uploadForm" class="mb-6">
          <label class="block w-full bg-indigo-500 text-white py-2 px-4 rounded-lg cursor-pointer text-center hover:bg-indigo-600 transition">
            Upload PDF
            <input type="file" name="pdf" class="hidden" onchange="document.getElementById('uploadForm').submit();" />
          </label>
        </form>
        <div class="flex-grow space-y-3 overflow-y-auto">
          ${docListHtml}
        </div>
        <a href="/logout" class="text-red-500 text-sm hover:underline mt-auto">Sign Out</a>
      </aside>
      <main class="flex-1 p-8 bg-gradient-to-br from-purple-50 to-indigo-100 flex items-center justify-center">
        <div class="text-gray-400">Select a document to view</div>
      </main>
    </body>
    </html>
  `);
});

// Auth Routes
app.get("/login", (c) => c.html(`
  <!DOCTYPE html>
  <html>
    <head><script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-gradient-to-br from-purple-500 to-indigo-600 h-screen flex justify-center items-center">
      <form action="/login" method="POST" class="bg-white p-8 rounded-xl shadow-2xl w-96 space-y-4">
        <h2 class="text-2xl font-bold text-gray-800 text-center">Login</h2>
        <input type="email" name="email" required placeholder="Email" class="w-full p-3 border rounded-lg" />
        <input type="password" name="password" required placeholder="Password" class="w-full p-3 border rounded-lg" />
        <button type="submit" class="w-full bg-indigo-500 text-white p-3 rounded-lg">Sign In</button>
      </form>
    </body>
  </html>
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

// Server Initialization
const port = parseInt(process.env.PORT || "3000");
serve({ fetch: app.fetch, port: port, hostname: '0.0.0.0' }, () => {
  console.log(`Server running on port ${port}`);
});
// Show the Signup Page
app.get("/login", (c) => c.html(`
  <!DOCTYPE html>
  <html>
    <head><script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-gradient-to-br from-purple-500 to-indigo-600 h-screen flex justify-center items-center">
      <form action="/login" method="POST" class="bg-white p-8 rounded-xl shadow-2xl w-96 space-y-4">
        <h2 class="text-2xl font-bold text-gray-800 text-center">Login</h2>
        <input type="email" name="email" required placeholder="Email" class="w-full p-3 border rounded-lg" />
        <input type="password" name="password" required placeholder="Password" class="w-full p-3 border rounded-lg" />
        <button type="submit" class="w-full bg-indigo-500 text-white p-3 rounded-lg">Sign In</button>
        <p class="text-center text-sm text-gray-600">Don't have an account? <a href="/signup" class="text-indigo-500 font-bold">Sign Up</a></p>
      </form>
    </body>
  </html>
`));
app.get("/logout", (c) => {
  deleteCookie(c, "sessionId", { path: "/" });
  return c.redirect("/login");
});

// Handle the Signup Logic
app.post("/signup", async (c) => {
  const { name, email, password } = await c.req.parseBody();
  
  // Check if user already exists
  const existingUser = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existingUser.length > 0) {
    return c.text("User already exists", 400);
  }

  // Add user to database
  await sql`INSERT INTO users (name, email, password) VALUES (${name}, ${email}, ${password})`;
  
  return c.redirect("/login");
});
