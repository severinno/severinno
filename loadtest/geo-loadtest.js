// geo-loadtest.js — Load test for geo endpoints
// Usage: npx autocannon -c 50 -d 30 -i loadtest/geo-loadtest.js http://localhost:3000

const endpoints = [
  {
    url: "http://localhost:3000/api/geo/cep?cep=30130000",
    method: "GET",
    headers: { "Content-Type": "application/json" },
  },
  {
    url: "http://localhost:3000/api/health",
    method: "GET",
    headers: { "Content-Type": "application/json" },
  },
]

module.exports = endpoints[0]
module.exports.endpoints = endpoints
