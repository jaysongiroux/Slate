import React from "react";

export default function PlainText(props: any) {
  return <span>{props.record?.params?.[props.property?.name] ?? ""}</span>;
}
