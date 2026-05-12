export interface Recipe {
  title: string | null;
  servings: string | null;
  time: string | null;
  ingredients: string[];
  steps: string[];
  notes: string[];
  confidence: number;
}

export interface PipelineResult {
  recipe: Recipe;
  source: "caption" | "ocr" | "claude";
  jobId: string;
}

export interface LogEntry {
  ts: number;   // ms since epoch
  msg: string;
}

export interface JobStatus {
  status: "pending" | "running" | "done" | "error";
  progress: string;
  logs: LogEntry[];
  result?: PipelineResult;
  error?: string;
  dbId?: number;
}
