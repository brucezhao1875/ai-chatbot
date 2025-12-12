export type SourceItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  transcript: string;
  score: number;
  metadata: {
    startTime: number;
    endTime: number;
  };
};
