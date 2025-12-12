import { POST } from "../app/api/chat/route";

async function main() {
  const req = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "正念是什么?" }],
    }),
  });

  const res = await POST(req);
  console.log("status", res.status, res.headers.get("content-type"));
  const reader = res.body?.getReader();
  if (!reader) {
    console.log(await res.text());
    return;
  }
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  console.log(output);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
