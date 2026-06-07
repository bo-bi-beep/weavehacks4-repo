import "dotenv/config";

console.log("Starting Attack KB server entrypoint...");
const { startAttackKbServer } = await import("./server.js");
console.log("Loaded Attack KB server module.");
startAttackKbServer();
