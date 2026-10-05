// AE Studio — After Effects ichida smoke-test (ES3).
// Ishlatish: AE → File → Scripts → Run Script File... → <extension>/ae-smoke.jsx
// Panel bundle'ini (jsx/index.js) yuklaydi, oplarni ikki marta yuboradi (idempotentlik) va natijani ko'rsatadi.
(function () {
  var NS = "com.aestudio.panel";
  var here = new File($.fileName).parent;
  var bundle = new File(here.fsName + "/jsx/index.js");
  if (!bundle.exists) {
    alert("jsx/index.js topilmadi: " + bundle.fsName);
    return;
  }
  $.evalFile(bundle);
  var api = $[NS];
  if (!api || !api.runOp) {
    alert("AE Studio jsx yuklanmadi");
    return;
  }

  var lines = [];
  var failed = 0;
  var stamp = new Date().getTime();
  var compId = "smoke.comp." + stamp;

  function run(op, opId, params) {
    var request = {
      op: { op_id: opId, seq: 0, op: op, params: params, timeout_ms: 30000 },
      ctx: { root: Folder.temp.fsName }
    };
    var res = JSON.parse(api.runOp(JSON.stringify(request)));
    return res;
  }

  function check(label, res, expectOk, expectReused) {
    var good = res.ok === expectOk;
    if (good && expectOk && expectReused !== undefined) good = res.data.reused === expectReused;
    if (!good) failed++;
    lines.push(
      (good ? "OK   " : "FAIL ") +
        label +
        (res.ok ? "" : " — " + res.error.code + ": " + res.error.message)
    );
  }

  check("ping", run("ping", "smoke.ping", {}), true);
  var compParams = { name: "AE Studio smoke", w: 1080, h: 1920, fps: 30, dur: 5, bg: "#101820" };
  check("comp.create", run("comp.create", compId, compParams), true, false);
  check("comp.create (qayta → reused)", run("comp.create", compId, compParams), true, true);
  var textParams = {
    comp: compId,
    text: "Salom, AE Studio!",
    start: 0,
    style: { size: 96, color: "#FFFFFF", justify: "center" },
    pos: [540, 960]
  };
  check("layer.add_text", run("layer.add_text", compId + ".title", textParams), true, false);
  check(
    "layer.add_text (qayta → reused)",
    run("layer.add_text", compId + ".title", textParams),
    true,
    true
  );
  check(
    "item.import (yo'q fayl → ASSET_MISSING)",
    run("item.import", "smoke.missing", { file: "none.mp4" }),
    false
  );
  check(
    "item.import ('..' → rad)",
    run("item.import", "smoke.escape", { file: "../x.mp4" }),
    false
  );

  alert(
    "AE Studio smoke-test: " +
      (failed === 0 ? "HAMMASI OK" : failed + " ta XATO") +
      "\nAE " +
      app.version +
      "\n\n" +
      lines.join("\n")
  );
})();
