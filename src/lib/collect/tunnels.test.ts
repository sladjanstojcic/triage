import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePortForward } from "./tunnels";

test("parsePortForward: resource, namespace, context and each local → remote port", () => {
  assert.deepEqual(parsePortForward("/opt/homebrew/bin/kubectl -n staging port-forward svc/web 8080:80 :9090 5432"), {
    resource: "svc/web",
    namespace: "staging",
    forwards: [{ local: 8080, remote: 80 }, { local: undefined, remote: 9090 }, { local: 5432, remote: 5432 }],
  });
  assert.deepEqual(parsePortForward("kubectl port-forward --context=prod --address 0.0.0.0 my-pod 3000:3000"), {
    resource: "pod/my-pod",
    context: "prod",
    forwards: [{ local: 3000, remote: 3000 }],
  });
});

test("parsePortForward: other kubectl commands and other programs are not port forwards", () => {
  assert.equal(parsePortForward("kubectl get pods -w"), undefined);
  assert.equal(parsePortForward("/usr/bin/ssh -L 8080:localhost:80 host"), undefined);
  assert.equal(parsePortForward("node port-forward.js"), undefined);
  // words before the subcommand are not the resource
  assert.equal(parsePortForward("kubectl -v 6 extra port-forward svc/api 7000:70")?.resource, "svc/api");
});
