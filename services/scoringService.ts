/**
 * Scoring Service - Hệ thống tính điểm mới
 * 
 * Quy tắc:
 * - Trắc nghiệm (MC): 0.25 điểm/câu
 * - Đúng/Sai (TF): 0.1 - 1.0 điểm/câu (tùy số ý đúng)
 *   + 1/4 ý đúng: 0.1 điểm
 *   + 2/4 ý đúng: 0.25 điểm
 *   + 3/4 ý đúng: 0.5 điểm
 *   + 4/4 ý đúng: 1.0 điểm
 * - Trả lời ngắn (SA): 0.5 điểm/câu
 */

import { Exam, Question, ScoreBreakdown } from '../types';

/**
 * Tính điểm cho một câu Đúng/Sai
 */
export function calculateTrueFalsePoints(correctCount: number): number {
  switch (correctCount) {
    case 4: return 1.0;
    case 3: return 0.5;
    case 2: return 0.25;
    case 1: return 0.1;
    default: return 0;
  }
}

/**
 * Chuẩn hóa đáp án (loại bỏ khoảng trắng, dấu phẩy)
 */
function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .trim();
}

/**
 * Tính điểm chi tiết cho bài làm
 */
export function calculateScore(
  answers: { [questionNumber: number]: string },
  exam: Exam
): ScoreBreakdown {
  const breakdown: ScoreBreakdown = {
    multipleChoice: {
      total: 0,
      correct: 0,
      points: 0
    },
    trueFalse: {
      total: 0,
      correct: 0,
      partial: 0,
      points: 0,
      details: {}
    },
    shortAnswer: {
      total: 0,
      correct: 0,
      points: 0
    },
    totalScore: 0,
    percentage: 0
  };

  exam.questions.forEach((q: Question) => {
    const userAnswer = answers[q.number];
    const correctAnswer = q.correctAnswer;

    // === PHẦN 1: TRẮC NGHIỆM ===
    if (q.type === 'multiple_choice') {
      breakdown.multipleChoice.total++;

      if (userAnswer && correctAnswer) {
        if (userAnswer.toUpperCase() === correctAnswer.toUpperCase()) {
          breakdown.multipleChoice.correct++;
          breakdown.multipleChoice.points += 0.25;
        }
      }
    }

    // === PHẦN 2: ĐÚNG SAI ===
    else if (q.type === 'true_false') {
      breakdown.trueFalse.total++;

      if (userAnswer && correctAnswer && q.options) {
        // Parse correct answers
        const correctStatements = correctAnswer
          .toLowerCase()
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        // Parse user answers
        let userStatements: string[] = [];
        try {
          // Thử parse JSON trước
          const parsed = JSON.parse(userAnswer);
          userStatements = Object.keys(parsed)
            .filter(key => parsed[key] === true)
            .map(key => key.toLowerCase());
        } catch {
          // Nếu không phải JSON, parse comma-separated
          userStatements = userAnswer
            .toLowerCase()
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        }

        // Đếm số ý đúng
        let correctCount = 0;
        for (const stmt of ['a', 'b', 'c', 'd']) {
          const shouldBeTrue = correctStatements.includes(stmt);
          const userSaidTrue = userStatements.includes(stmt);
          if (shouldBeTrue === userSaidTrue) {
            correctCount++;
          }
        }

        // Tính điểm
        const points = calculateTrueFalsePoints(correctCount);
        breakdown.trueFalse.points += points;
        breakdown.trueFalse.details[q.number] = {
          correctCount,
          points
        };

        if (correctCount === 4) {
          breakdown.trueFalse.correct++;
        } else if (correctCount > 0) {
          breakdown.trueFalse.partial++;
        }
      }
    }

    // === PHẦN 3: TRẢ LỜI NGẮN ===
    else if (q.type === 'short_answer' || q.type === 'writing') {
      breakdown.shortAnswer.total++;

      if (userAnswer && correctAnswer) {
        const normalizedUser = normalizeAnswer(userAnswer);
        const normalizedCorrect = normalizeAnswer(correctAnswer);

        if (normalizedUser === normalizedCorrect) {
          breakdown.shortAnswer.correct++;
          breakdown.shortAnswer.points += 0.5;
        }
      }
    }
  });

  // Tính tổng điểm (thang 10)
  breakdown.totalScore = 
    breakdown.multipleChoice.points +
    breakdown.trueFalse.points +
    breakdown.shortAnswer.points;

  // Tính phần trăm
  const maxScore = 
    breakdown.multipleChoice.total * 0.25 +
    breakdown.trueFalse.total * 1.0 +
    breakdown.shortAnswer.total * 0.5;

  breakdown.percentage = maxScore > 0
    ? Math.round((breakdown.totalScore / maxScore) * 100)
    : 0;

  return breakdown;
}

/**
 * Format điểm hiển thị (làm tròn 2 chữ số)
 */
export function formatScore(score: number): string {
  return score.toFixed(2);
}

/**
 * Lấy grade từ điểm (A+, A, B, C, D, F)
 */
export function getGrade(score: number): {
  grade: string;
  color: string;
  emoji: string;
  label: string;
  bg: string;
} {
  if (score >= 9.0) return { grade: 'A+', color: 'text-green-600', bg: 'bg-green-100', emoji: '🏆', label: 'Xuất sắc' };
  if (score >= 8.0) return { grade: 'A', color: 'text-green-600', bg: 'bg-green-100', emoji: '🌟', label: 'Giỏi' };
  if (score >= 7.0) return { grade: 'B+', color: 'text-blue-600', bg: 'bg-blue-100', emoji: '👍', label: 'Khá' };
  if (score >= 6.0) return { grade: 'B', color: 'text-blue-600', bg: 'bg-blue-100', emoji: '📚', label: 'Trung bình khá' };
  if (score >= 5.0) return { grade: 'C', color: 'text-yellow-600', bg: 'bg-yellow-100', emoji: '💪', label: 'Trung bình' };
  if (score >= 4.0) return { grade: 'D', color: 'text-orange-600', bg: 'bg-orange-100', emoji: '📖', label: 'Yếu' };
  return { grade: 'F', color: 'text-red-600', bg: 'bg-red-100', emoji: '😞', label: 'Kém' };
}

/**
 * Tính tổng số câu đúng hoàn toàn (dùng để hiển thị)
 */
export function getTotalCorrectCount(breakdown: ScoreBreakdown): number {
  return (
    breakdown.multipleChoice.correct +
    breakdown.trueFalse.correct +
    breakdown.shortAnswer.correct
  );
}

/**
 * Tính tổng số câu sai
 */
export function getTotalWrongCount(breakdown: ScoreBreakdown, totalQuestions: number): number {
  const correctCount = getTotalCorrectCount(breakdown);
  return totalQuestions - correctCount;
}
