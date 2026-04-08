export type ReviewStatus = 'pending' | 'draft' | 'sent';

export interface ReviewDto {
  id: number;
  studentId: number;
  studentName: string;
  githubUsername: string | null;
  month: string;
  status: ReviewStatus;
  subject: string | null;
  body: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}
