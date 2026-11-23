import type { ComponentProps } from "react";
export function Table(props: ComponentProps<"table">) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={props["aria-label"] || "Bảng dữ liệu"}
      tabIndex={0}
    >
      <table className="data-table" {...props} />
    </div>
  );
}
export function TableHead(props: ComponentProps<"th">) {
  return <th scope="col" {...props} />;
}
export function TableCell(props: ComponentProps<"td">) {
  return <td {...props} />;
}
