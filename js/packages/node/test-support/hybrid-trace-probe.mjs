import fs from "node:fs";
import { resolve } from "node:path";
import tls from "node:tls";

const fixtures = resolve(process.argv[2]);
const read = (name) => fs.readFileSync(resolve(fixtures, name));
const groupOptions = {
  minVersion: "TLSv1.3",
  maxVersion: "TLSv1.3",
  ecdhCurve: "X25519MLKEM768",
};

const server = tls.createServer({
  ...groupOptions,
  cert: read("server_cert.pem"),
  key: read("server_key.pem"),
}, (socket) => {
  socket.end();
  server.close();
});

server.on("tlsClientError", (error) => {
  process.exitCode = 1;
  console.error(error);
});

server.listen(0, "127.0.0.1", () => {
  const client = tls.connect({
    ...groupOptions,
    host: "127.0.0.1",
    port: server.address().port,
    servername: "localhost",
    ca: [read("ca_cert.pem")],
    rejectUnauthorized: true,
    enableTrace: true,
  });
  client.enableTrace();
  client.on("error", (error) => {
    process.exitCode = 1;
    console.error(error);
    server.close();
  });
});
