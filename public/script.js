console.log("✅ script.js loaded");

document.getElementById("sendBtn").addEventListener("click", async () => {
  const inputBox = document.getElementById("userInput");
  const responseBox = document.getElementById("response");
  const prompt = inputBox.value.trim();
  if (!prompt) return alert("Please enter a question first!");

  responseBox.textContent = "Thinking...";

  try {
    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    const data = await res.json().catch(() => ({})); // parse error or success

    if (!res.ok) {
      console.error("Server error payload:", data);
      responseBox.textContent =
        `Error ${data.status || res.status}: ` +
        (data.message || data.error || "Unknown");
      return;
    }

    responseBox.textContent = data.output || "(no text)";
  } catch (err) {
    console.error("❌ Frontend error:", err);
    responseBox.textContent = "Error connecting to server.";
  }
});
