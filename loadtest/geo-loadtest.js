// geo-loadtest.js — Load test for geo endpoints
// Usage: npx autocannon -c 50 -d 30 -i loadtest/geo-loadtest.js http://localhost:3000

module.exports = {
  url: "http://localhost:3000/api/health",
  method: "GET",
  headers: {
    "Content-Type": "application/json",
  },
  // For POST endpoints, add body:
  // body: JSON.stringify({...}),
}
