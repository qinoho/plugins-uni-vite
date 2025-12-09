import { parse as U } from "@vue/compiler-sfc";
import * as i from "path";
import * as j from "fs";
function T(W = {}) {
  const {
    extensions: R = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"],
    replacementFn: z,
    srcRoot: y = "src",
    enableReplace: v = !1,
    // 是否启用替换功能
    // 兼容传入多个命名替换函数（将逐个尝试）
    replacements: k,
    excludeUnused: M = !0,
    // 新增选项：是否排除未使用资源
    additionalChecks: D = []
    // 新增：额外的检查规则
  } = W, p = /* @__PURE__ */ new Set(), S = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map(), x = /* @__PURE__ */ new Set(), A = (e) => {
    if (e.startsWith("http") || e.startsWith("data:") || !e.includes("."))
      return !1;
    const t = i.extname(e).toLowerCase();
    return R.includes(t);
  }, E = (e, t) => {
    if (e.startsWith("@/"))
      return i.resolve(y, e.slice(2));
    if (e.startsWith("./") || e.startsWith("../")) {
      const o = i.dirname(t);
      return i.resolve(o, e);
    }
    return i.isAbsolute(e) ? e : i.resolve(y, e);
  }, I = (e, t) => {
    if (typeof z == "function") {
      const o = z(t, e);
      if (o) return o;
    }
    return t;
  }, C = (e, t, o, n) => {
    d.has(n) || d.set(n, []);
    const l = d.get(n);
    l && l.push({ type: e, original: t, replacement: o });
  }, b = (e) => {
    if (!j.existsSync(e)) return;
    const t = j.readdirSync(e, { withFileTypes: !0 });
    for (const o of t) {
      const n = i.join(e, o.name);
      if (o.isDirectory())
        b(n);
      else {
        const l = i.extname(o.name).toLowerCase();
        R.includes(l) && x.add(n);
      }
    }
  };
  return {
    name: "detect-static",
    enforce: "pre",
    transform(e, t) {
      if (t.endsWith(".vue")) {
        debugger;
        try {
          const { descriptor: o } = U(e);
          let n = !1, l = e;
          const h = o.script || o.scriptSetup;
          if (h) {
            let s = h.content;
            const w = /import\s+(?:(\w+)|{([^}]+)}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
            let $;
            for (; ($ = w.exec(s)) !== null; ) {
              const [f, r, u, c, a] = $;
              if (A(a)) {
                const m = E(a, t);
                if (r && (S.set(r, {
                  originalPath: a,
                  resolvedPath: m
                }), console.log(
                  `📦 检测到默认导入资源: ${r} -> ${a}==${m}`
                ), v)) {
                  const g = I(m, a);
                  if (g) {
                    if (g.startsWith("http")) {
                      const L = `const ${r} = '${g}'`;
                      s = s.replace(f, L), C("import-to-url", a, g, t), console.log(`🔄 替换导入为URL变量: ${r} = '${g}'`);
                    } else {
                      const L = f.replace(a, g);
                      s = s.replace(f, L), C("import", a, g, t), console.log(`🔄 替换导入路径: ${a} -> ${g}`);
                    }
                    n = !0;
                  }
                }
              }
            }
            n && s !== h.content && (l = l.replace(h.content, s));
          }
          if (o.template) {
            let s = o.template.content;
            const w = new RegExp(`(?<!:)src\\s*=\\s*["']([^"']+)["']`, "g");
            s = s.replace(
              w,
              (f, r) => {
                if (A(r)) {
                  const u = E(r, t);
                  if (p.add(u), console.log(`📦 检测到静态资源: ${r} -> ${u}`), v) {
                    const c = I(u, r);
                    if (c)
                      return C("template-static", r, c, t), console.log(f.replace(r, c)), f.replace(r, c);
                  }
                }
                return f;
              }
            );
            const $ = /:src\s*=\s*["']([^"']+)["']/g;
            s = s.replace(
              $,
              (f, r) => {
                if (S.has(r)) {
                  const u = S.get(r), { resolvedPath: c } = u;
                  p.add(c), console.log(`📦 检测到动态绑定资源: ${r} -> ${c}`);
                } else
                  console.log(`⚠️  检测到动态绑定: ${r} (在 ${t}) - 需要手动检查`);
                return f;
              }
            ), s !== o.template.content && (n = !0, l = l.replace(o.template.content, s));
          }
          if (o.styles && o.styles.length > 0)
            for (let s = 0; s < o.styles.length; s++) {
              const w = o.styles[s];
              let $ = w.content;
              const f = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/g, r = $.replace(
                f,
                (u, c) => {
                  if (A(c)) {
                    const a = E(c, t);
                    if (p.add(a), console.log(
                      `📦 检测到CSS资源: ${c} -> ${a} (style块 ${s + 1})`
                    ), v) {
                      const m = I(a, c);
                      if (m)
                        return C("css-url", c, m, t), console.log(
                          `🔄 替换CSS资源: ${c} -> ${m} (style块 ${s + 1})`
                        ), u.replace(c, m);
                    }
                  }
                  return u;
                }
              );
              r !== $ && (n = !0, l = l.replace(w.content, r));
            }
          return n ? { code: l, map: null } : null;
        } catch (o) {
          console.warn(`解析 Vue 文件失败: ${t}`, o);
        }
      }
    },
    buildStart(e) {
      console.log("🔍 开始检测模板中的静态资源..."), p.clear(), S.clear(), d.clear(), b(y);
    },
    buildEnd() {
      if (console.log(`
📊 检测结果汇总:`), console.log(`共扫描到 ${x.size} 个静态资源`), console.log(`共检测到 ${p.size} 个已使用资源:`), p.forEach((e) => {
        console.log(`  ✅ ${i.relative(process.cwd(), e)}`);
      }), M) {
        const e = Array.from(x).filter((t) => !p.has(t));
        e.length > 0 && (console.log(`
⚠️  发现 ${e.length} 个未使用的资源:`), e.forEach((t) => {
          console.log(`  ❌ ${i.relative(process.cwd(), t)}`);
        }), console.log(`
💡 这些资源已被阻止打包，建议手动删除以清理项目`));
      }
      v && d.size > 0 && (console.log(`
🔄 替换操作汇总:`), d.forEach((e, t) => {
        console.log(`
文件: ${t}`), e.forEach(({ type: o, original: n, replacement: l }) => {
          console.log(`  [${o}] ${n} -> ${l}`);
        });
      }));
    },
    resolveId(e, t) {
      const o = i.extname(e).toLowerCase();
      if (R.includes(o)) {
        let n = e;
        if (e.startsWith("@/") ? n = i.resolve(y, e.replace("@/", "")) : (e.startsWith("./") || e.startsWith("../")) && (n = i.resolve(i.dirname(t || ""), e)), n = i.normalize(n), M && x.has(n)) {
          let l = !1;
          if (D.forEach((h) => {
            h(n) && (p.add(n), l = !0);
          }), !p.has(n) && !l)
            return console.log(`🚫 阻止未使用资源: ${i.relative(process.cwd(), n)}`), !1;
        }
      }
      return null;
    }
  };
}
function B(W) {
  return `Hello, ${W}!`;
}
export {
  T as detectStatic,
  B as hello
};
