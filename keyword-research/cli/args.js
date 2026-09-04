// 最小限のCLI引数パーサー(新規依存を避けるための自前実装)。
// --flag / --key value / --key=value に対応する。

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        args[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

export function todayJst() {
  // JSTを明示(タイムゾーンに依存しないよう、UTC+9で日付だけ計算する)
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function nowJstIso() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace("Z", "+09:00");
}
