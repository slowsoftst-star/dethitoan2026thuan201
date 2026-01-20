// ============ ENUMS ============

export enum Role {
  STUDENT = 'student',
  TEACHER = 'teacher',
  ADMIN = 'admin',
  MEMBER = 'member',
  DEPUTY = 'deputy',
  LEADER = 'leader'
}

// ============ QUESTION TYPES ============

export type QuestionType = 
  | 'multiple_choice'   // Trắc nghiệm nhiều lựa chọn (PHẦN 1)
  | 'true_false'        // Đúng sai (PHẦN 2)
  | 'short_answer'      // Trả lời ngắn (PHẦN 3)
  | 'writing'           // Viết (cho Tiếng Anh)
  | 'unknown';

// ============ IMAGE DATA ============

export interface ImageData {
  id: string;           // ID duy nhất (vd: img_0, img_1)
  filename: string;     // Tên file gốc (image1.png, etc.)
  base64: string;       // Dữ liệu base64
  contentType: string;  // MIME type (image/png, image/jpeg, etc.)
  rId?: string;         // Relationship ID trong Word (rId4, rId5...)
}

// ============ USER ============

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  role: Role;
  status?: 'online' | 'offline' | 'busy';
  isApproved?: boolean;
  createdAt?: Date;
  // ✅ MỚI: Thông tin lớp học cho học sinh
  classIds?: string[];  // Danh sách ID các lớp học sinh tham gia
}

// ============ CLASS (MỚI) ============

export interface Class {
  id: string;
  name: string;          // Tên lớp (VD: "10A1", "Toán 11", etc.)
  grade?: string;        // Khối (10, 11, 12)
  subject?: string;      // Môn học (Toán, Lý, Hóa, etc.)
  teacherId: string;     // ID giáo viên chủ nhiệm
  teacherName: string;   // Tên giáo viên
  studentIds: string[];  // Danh sách ID học sinh trong lớp
  totalStudents: number; // Tổng số học sinh
  createdAt?: Date;
  updatedAt?: Date;
}

// ============ STUDENT INFO ============

export interface StudentInfo {
  id: string;
  name: string;
  email?: string;        // ✅ MỚI: Email của học sinh
  avatar?: string;       // ✅ MỚI: Avatar
  className?: string;    // Tên lớp (hiển thị)
  classId?: string;      // ✅ MỚI: ID lớp
  studentId?: string;    // Mã học sinh (nếu có)
}

// ============ QUESTION & OPTIONS ============

export interface QuestionOption {
  letter: string;         // A, B, C, D hoặc a, b, c, d
  text: string;           // Nội dung option (có thể chứa LaTeX)
  textWithUnderline?: string;  // Text với HTML underline (cho Tiếng Anh)
  isCorrect?: boolean;    // Đáp án đúng
}

export interface SectionInfo {
  letter: string;         // 1, 2, 3 hoặc A, B, C
  name: string;           // Tên phần
  points: string;         // Điểm
}

export interface Question {
  number: number;                    // Số thứ tự câu hỏi (101, 102... cho PHẦN 1)
  text: string;                      // Nội dung câu hỏi (có thể chứa LaTeX)
  type: QuestionType;                // Loại câu hỏi
  options: QuestionOption[];         // Các đáp án lựa chọn
  correctAnswer: string | null;      // Đáp án đúng (A/B/C/D, a,b,c hoặc số)
  section?: SectionInfo;             // Thông tin section
  part?: string;                     // Phần (PHẦN 1, 2, 3)
  passage?: string;                  // Đoạn văn đọc hiểu
  solution?: string;                 // Lời giải chi tiết
  images?: ImageData[];              // Hình ảnh trong câu hỏi
  tfStatements?: { [key: string]: string };  // Các mệnh đề đúng sai (a, b, c, d)
}

// ============ EXAM SECTION ============

export interface ExamSection {
  name: string;
  description: string;
  points: string;
  readingPassage?: string;
  questions: Question[];
  sectionType?: QuestionType;  // Loại câu hỏi của section
}

// ============ EXAM DATA (for parsing) ============

export interface ExamData {
  title: string;
  subject?: 'math' | 'english' | 'other';  // Môn học
  timeLimit?: number;
  sections: ExamSection[];
  questions: Question[];
  answers: { [key: number]: string };
  images?: ImageData[];  // Tất cả hình ảnh trong đề
}

// ============ EXAM (stored in Firebase) ============

export interface Exam {
  id: string;
  title: string;
  description?: string;
  subject?: string;
  timeLimit: number;
  questions: Question[];
  sections: ExamSection[];
  answers: { [key: number]: string };
  images?: ImageData[];
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ============ ROOM ============

export interface Room {
  id: string;
  code: string;
  examId: string;
  examTitle: string;
  teacherId: string;
  teacherName: string;
  classId?: string;      // ✅ MỚI: ID lớp (nếu phòng dành cho 1 lớp cụ thể)
  className?: string;    // ✅ MỚI: Tên lớp
  status: 'waiting' | 'active' | 'closed';
  startTime?: Date;
  endTime?: Date;
  timeLimit: number;
  allowLateJoin: boolean;
  showResultAfterSubmit: boolean;
  shuffleQuestions: boolean;
  maxAttempts: number;
  totalStudents: number;
  submittedCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// ============ SCORE BREAKDOWN (MỚI) ============

export interface ScoreBreakdown {
  multipleChoice: {
    total: number;        // Tổng số câu trắc nghiệm
    correct: number;      // Số câu đúng
    points: number;       // Điểm (0.25/câu)
  };
  trueFalse: {
    total: number;        // Tổng số câu đúng sai
    correct: number;      // Số câu đúng hoàn toàn (4/4 ý)
    partial: number;      // Số câu đúng một phần
    points: number;       // Tổng điểm
    details: {            // Chi tiết từng câu
      [questionNumber: number]: {
        correctCount: number;  // Số ý đúng (0-4)
        points: number;        // Điểm câu này
      };
    };
  };
  shortAnswer: {
    total: number;        // Tổng số câu trả lời ngắn
    correct: number;      // Số câu đúng
    points: number;       // Điểm (0.5/câu)
  };
  totalScore: number;     // Tổng điểm (thang 10)
  percentage: number;     // Phần trăm
}

// ============ SUBMISSION (CẢI TIẾN) ============

export interface Submission {
  id: string;
  roomId: string;
  roomCode: string;
  examId: string;
  student: StudentInfo;
  answers: { [questionNumber: number]: string };
  
  // ✅ CẢI TIẾN: Hệ thống tính điểm mới
  scoreBreakdown: ScoreBreakdown;   // Chi tiết điểm từng phần
  totalScore: number;                // Tổng điểm (thang 10)
  percentage: number;                // Phần trăm
  
  // Giữ lại để tương thích
  score: number;                     // = totalScore
  correctCount: number;              // Tổng số câu đúng hoàn toàn
  wrongCount: number;
  totalQuestions: number;
  
  // ✅ MỚI: Chống gian lận
  tabSwitchCount: number;            // Số lần chuyển tab
  tabSwitchWarnings: Date[];         // Thời điểm các lần cảnh báo
  autoSubmitted: boolean;            // Có tự động nộp do gian lận không
  
  startedAt?: Date;
  submittedAt?: Date;
  duration: number;
  status: 'in_progress' | 'submitted' | 'graded';
}

// ============ ROOM WITH EXAM ============

export interface RoomWithExam extends Room {
  exam: Exam;
}

// ============ LEADERBOARD ============

export interface LeaderboardEntry {
  rank: number;
  student: StudentInfo;
  score: number;          // Tổng điểm (thang 10)
  percentage: number;
  duration: number;
  submittedAt?: Date;
  scoreBreakdown?: ScoreBreakdown;  // ✅ MỚI: Chi tiết điểm
}

// ============ CLASS JOIN REQUEST ============

export interface ClassJoinRequest {
  id: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: Date;
  processedAt?: Date;
  processedBy?: string;
}
