export interface Log {
  id: number;
  content: string;
  type: "info" | "warning" | "error";
  timestamp: string;
}
