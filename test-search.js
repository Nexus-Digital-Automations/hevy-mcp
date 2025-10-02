#!/usr/bin/env node
/**
 * Test script for the search-exercises tool
 * Usage: node test-search.js
 */

import { spawn } from "child_process";
import { createInterface } from "readline";

const API_KEY =
	process.env.HEVY_API_KEY || "691faeff-52b4-46c3-a50a-1ca40cb3b6d6";

// Test different search queries
const testQueries = [
	{
		name: "Search for 'squat'",
		request: {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "search-exercises",
				arguments: {
					query: "squat",
					limit: 10,
				},
			},
		},
	},
	{
		name: "Search for 'bench press'",
		request: {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "search-exercises",
				arguments: {
					query: "bench press",
					limit: 5,
				},
			},
		},
	},
	{
		name: "Search for exercises with muscle group filter",
		request: {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: {
				name: "search-exercises",
				arguments: {
					query: "curl",
					muscleGroup: "biceps",
					limit: 5,
				},
			},
		},
	},
];

console.log("🔍 Testing search-exercises tool...");
console.log("API Key configured:", API_KEY.substring(0, 8) + "...");
console.log("");

// Start the MCP server
const server = spawn("npm", ["run", "dev"], {
	env: {
		...process.env,
		HEVY_API_KEY: API_KEY,
		NODE_ENV: "development",
	},
	stdio: ["pipe", "pipe", "pipe"],
});

// Create readline interface for server output
const rl = createInterface({
	input: server.stdout,
	crlfDelay: Number.POSITIVE_INFINITY,
});

let currentTestIndex = 0;
let serverReady = false;

// Handle server output
rl.on("line", (line) => {
	try {
		const data = JSON.parse(line);
		console.log(
			"📥 Response:",
			JSON.stringify(data, null, 2).substring(0, 500) + "...",
		);
		console.log("");

		// Move to next test
		currentTestIndex++;
		if (currentTestIndex < testQueries.length) {
			setTimeout(() => runNextTest(), 1000);
		} else {
			console.log("✅ All tests completed!");
			server.kill();
			process.exit(0);
		}
	} catch (error) {
		// Not JSON, probably server log
		console.log("📋 Server:", line);

		// Check if server is ready
		if (line.includes("Starting MCP server") || serverReady) {
			serverReady = true;
		}
	}
});

// Handle server errors
server.stderr.on("data", (data) => {
	console.error("❌ Server error:", data.toString());
});

// Handle server exit
server.on("close", (code) => {
	console.log(`Server exited with code ${code}`);
	process.exit(code || 0);
});

// Function to run the next test
function runNextTest() {
	if (currentTestIndex >= testQueries.length) {
		return;
	}

	const test = testQueries[currentTestIndex];
	console.log(`\n🧪 Test ${currentTestIndex + 1}: ${test.name}`);
	console.log("📤 Request:", JSON.stringify(test.request, null, 2));
	console.log("");

	server.stdin.write(JSON.stringify(test.request) + "\n");
}

// Wait for server to be ready then start tests
setTimeout(() => {
	console.log("🚀 Starting tests...\n");
	runNextTest();
}, 5000);

// Handle script termination
process.on("SIGINT", () => {
	console.log("\n⚠️  Interrupted, shutting down...");
	server.kill();
	process.exit(0);
});
