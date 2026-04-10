import React from "react";

export default function PlainText(props: any) {
  const label = props.property?.label ?? props.property?.name ?? "";
  const value = (props.record?.params?.[props.property?.name] ?? "").replace(/\n/g, "\\n");
  return (
    <div style={{ marginBottom: "24px" }}>
      <p style={{ color: "#898A9B", fontSize: "12px", fontWeight: 400, marginBottom: "4px" }}>
        {label}
      </p>
      <p style={{ fontSize: "14px" }}>{value}</p>
    </div>
  );
}
