import type { LinkwardenLink } from "@slate/shared";

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsla(${hue}, 50%, 65%, 0.45)`;
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function getLinkDotColor(link: LinkwardenLink): string {
  return link.collection?.color ? `${link.collection.color}80` : hashColor(getDomain(link.url));
}

interface LinkRowProps {
  link: LinkwardenLink;
}

export function LinkRow({ link }: LinkRowProps) {
  const dotColor = getLinkDotColor(link);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 0",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 5,
          height: 5,
          flexShrink: 0,
          borderRadius: "50%",
          backgroundColor: dotColor,
        }}
      />
      <span
        style={{
          flex: "1 1 0",
          width: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "0.82rem",
          color: "rgba(255,255,255,0.75)",
        }}
      >
        {link.name || link.url}
      </span>
      <span
        style={{
          flexShrink: 0,
          maxWidth: 120,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "0.7rem",
          color: "rgba(255,255,255,0.2)",
        }}
      >
        {getDomain(link.url)}
      </span>
    </div>
  );
}
