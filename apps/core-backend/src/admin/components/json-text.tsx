import React from "react";

function unflattenFromParams(params: Record<string, unknown>, prefix: string) {
  const prefixDot = `${prefix}.`;
  const root: any = {};
  let found = false;
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(prefixDot)) continue;
    found = true;
    const segs = key.slice(prefixDot.length).split(".");
    let cur: any = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      const nextIsArrayIndex = /^\d+$/.test(segs[i + 1]);
      if (cur[seg] === undefined) cur[seg] = nextIsArrayIndex ? [] : {};
      cur = cur[seg];
    }
    cur[segs[segs.length - 1]] = value;
  }
  return found ? root : undefined;
}

export default function JsonText(props: any) {
  const name: string = props.property?.name ?? "";
  const label: string = props.property?.label ?? name;
  const params: Record<string, unknown> = props.record?.params ?? {};

  let raw: unknown = params[name];
  if (raw === undefined || raw === null || raw === "") {
    raw = unflattenFromParams(params, name);
  }

  let text: string;
  if (raw === undefined || raw === null) {
    text = "";
  } else if (typeof raw === "string") {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      text = raw;
    }
  } else {
    try {
      text = JSON.stringify(raw, null, 2);
    } catch {
      text = String(raw);
    }
  }

  return (
    <div style={{ marginBottom: "24px" }}>
      <p style={{ color: "#898A9B", fontSize: "12px", fontWeight: 400, marginBottom: "4px" }}>
        {label}
      </p>
      <pre
        style={{
          fontSize: "12px",
          backgroundColor: "#f8faff",
          padding: "12px",
          borderRadius: "4px",
          overflow: "auto",
          color: "#152033",
          margin: 0,
          maxHeight: "600px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </pre>
    </div>
  );
}
