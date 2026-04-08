export interface CheckinEntry {
  taName: string;
  wasPresent?: boolean;
}

export interface PendingCheckinResponse {
  weekOf: string;
  alreadySubmitted: boolean;
  entries: CheckinEntry[];
}
