import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signOut, 
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  addDoc,
  updateDoc,
  deleteDoc,
  collection, 
  query, 
  where, 
  getDocs,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  DocumentData
} from 'firebase/firestore';
import { Exam, Room, Submission, StudentInfo, User, Role, Question, Class, ClassJoinRequest } from '../types';
import { calculateScore, getTotalCorrectCount, getTotalWrongCount } from './scoringService';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "THỰC TẾ",
  authDomain: "THỰC TẾ",
  projectId: "THỰC TẾ",
  storageBucket: "THỰC TẾ",
  messagingSenderId: "THỰC TẾ",
  appId: "THỰC TẾ",
  measurementId: "THỰC TẾ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ============ HELPER FUNCTIONS ============
const toDate = (timestamp: Timestamp | Date | undefined | null): Date | undefined => {
  if (!timestamp) return undefined;
  if (timestamp instanceof Timestamp) return timestamp.toDate();
  if (timestamp instanceof Date) return timestamp;
  return undefined;
};

// ============ AUTH FUNCTIONS ============

export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const firebaseUser = result.user;
    
    const userRef = doc(db, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      const hasUsers = await hasAnyUsers();
      const isFirstUser = !hasUsers;
      
      const newUser: User = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || 'Unknown',
        email: firebaseUser.email || undefined,
        avatar: firebaseUser.photoURL || undefined,
        role: isFirstUser ? Role.ADMIN : Role.TEACHER,
        isApproved: isFirstUser,
        createdAt: new Date(),
        classIds: []
      };
      
      await setDoc(userRef, {
        ...newUser,
        createdAt: serverTimestamp()
      });
      
      return newUser;
    }
    
    const userData = userSnap.data();
    return {
      id: userSnap.id,
      name: userData.name || '',
      email: userData.email,
      avatar: userData.avatar,
      role: userData.role || Role.TEACHER,
      isApproved: userData.isApproved ?? false,
      createdAt: toDate(userData.createdAt),
      classIds: userData.classIds || []
    };
  } catch (error) {
    console.error('Google sign in error:', error);
    throw error;
  }
};

// ✅ STUDENT LOGIN với Google
export const signInStudentWithGoogle = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const firebaseUser = result.user;
    
    const userRef = doc(db, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      // Tạo tài khoản học sinh mới
      const newStudent: User = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || 'Unknown',
        email: firebaseUser.email || undefined,
        avatar: firebaseUser.photoURL || undefined,
        role: Role.STUDENT,
        // ✅ Học sinh phải được Admin duyệt
        isApproved: false,
        createdAt: new Date(),
        classIds: []       // Chưa có lớp
      };
      
      await setDoc(userRef, {
        ...newStudent,
        createdAt: serverTimestamp()
      });
      
      return newStudent;
    }
    
    const userData = userSnap.data();

    // "An toàn hơn": chỉ tự sửa role về STUDENT khi tài khoản CHƯA được duyệt.
    // Mục tiêu: xử lý các tài khoản học sinh từng đăng nhập nhầm ở cổng giáo viên (role=TEACHER, isApproved=false),
    // nhưng không đụng vào giáo viên đã được duyệt (isApproved=true) nếu họ lỡ bấm cổng học sinh.
    const approved = userData.isApproved ?? false;

    if (!approved && userData.role !== Role.STUDENT) {
      await setDoc(userRef, { role: Role.STUDENT }, { merge: true });
    }

    return {
      id: userSnap.id,
      name: userData.name || '',
      email: userData.email,
      avatar: userData.avatar,
      role: Role.STUDENT,
      isApproved: userData.isApproved ?? false,
      createdAt: toDate(userData.createdAt),
      classIds: userData.classIds || []
    };
  } catch (error) {
    console.error('Student Google sign in error:', error);
    throw error;
  }
};

export const signOutUser = () => signOut(auth);

let anonymousSignInPromise: Promise<void> | null = null;

export const ensureSignedIn = async (): Promise<void> => {
  if (auth.currentUser) return;

  if (!anonymousSignInPromise) {
    anonymousSignInPromise = signInAnonymously(auth)
      .then(() => {})
      .finally(() => { anonymousSignInPromise = null; });
  }

  await anonymousSignInPromise;
};

export const hasAnyUsers = async (): Promise<boolean> => {
  const snapshot = await getDocs(collection(db, 'users'));
  return !snapshot.empty;
};

export const isUserAdmin = async (userId: string): Promise<boolean> => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  
  if (userSnap.exists()) {
    const role = userSnap.data().role;
    return role === Role.ADMIN || role === Role.LEADER;
  }
  return false;
};

export const getCurrentUser = async (): Promise<User | null> => {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return null;
  
  const userRef = doc(db, 'users', firebaseUser.uid);
  const userSnap = await getDoc(userRef);
  
  if (userSnap.exists()) {
    const userData = userSnap.data();
    return {
      id: userSnap.id,
      name: userData.name || '',
      email: userData.email,
      avatar: userData.avatar,
      role: userData.role || Role.TEACHER,
      isApproved: userData.isApproved ?? false,
      createdAt: toDate(userData.createdAt),
      classIds: userData.classIds || []
    };
  }
  return null;
};

// ============ CLASS MANAGEMENT ============

/**
 * Tạo lớp học mới
 */
export const createClass = async (classData: {
  name: string;
  grade?: string;
  subject?: string;
  teacherId: string;
  teacherName: string;
}): Promise<string> => {
  const newClass: Omit<Class, 'id'> = {
    name: classData.name,
    grade: classData.grade,
    subject: classData.subject,
    teacherId: classData.teacherId,
    teacherName: classData.teacherName,
    studentIds: [],
    totalStudents: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  const classRef = await addDoc(collection(db, 'classes'), {
    ...newClass,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  
  return classRef.id;
};

/**
 * Lấy tất cả lớp học (cho admin)
 */
export const getAllClasses = async (): Promise<Class[]> => {
  const snapshot = await getDocs(collection(db, 'classes'));
  const classes = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name || '',
      grade: data.grade,
      subject: data.subject,
      teacherId: data.teacherId || '',
      teacherName: data.teacherName || '',
      studentIds: data.studentIds || [],
      totalStudents: data.totalStudents || 0,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt)
    };
  });
  
  classes.sort((a, b) => {
    const dateA = a.createdAt?.getTime() || 0;
    const dateB = b.createdAt?.getTime() || 0;
    return dateB - dateA;
  });
  
  return classes;
};

/**
 * Lấy danh sách lớp của giáo viên
 */
export const getClassesByTeacher = async (teacherId: string): Promise<Class[]> => {
  const q = query(
    collection(db, 'classes'),
    where('teacherId', '==', teacherId)
  );
  
  const snapshot = await getDocs(q);
  const classes = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name || '',
      grade: data.grade,
      subject: data.subject,
      teacherId: data.teacherId || '',
      teacherName: data.teacherName || '',
      studentIds: data.studentIds || [],
      totalStudents: data.totalStudents || 0,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt)
    };
  });
  
  classes.sort((a, b) => {
    const dateA = a.createdAt?.getTime() || 0;
    const dateB = b.createdAt?.getTime() || 0;
    return dateB - dateA;
  });
  
  return classes;
};

/**
 * Lấy thông tin lớp
 */
export const getClass = async (classId: string): Promise<Class | null> => {
  const classRef = doc(db, 'classes', classId);
  const classSnap = await getDoc(classRef);
  
  if (classSnap.exists()) {
    const data = classSnap.data();
    return {
      id: classSnap.id,
      name: data.name || '',
      grade: data.grade,
      subject: data.subject,
      teacherId: data.teacherId || '',
      teacherName: data.teacherName || '',
      studentIds: data.studentIds || [],
      totalStudents: data.totalStudents || 0,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt)
    };
  }
  return null;
};

/**
 * Thêm học sinh vào lớp
 */
export const addStudentToClass = async (classId: string, studentId: string): Promise<void> => {
  const classRef = doc(db, 'classes', classId);
  const classSnap = await getDoc(classRef);
  
  if (!classSnap.exists()) {
    throw new Error('Class not found');
  }
  
  const classData = classSnap.data();
  const studentIds = classData.studentIds || [];
  
  if (!studentIds.includes(studentId)) {
    studentIds.push(studentId);
    
    await updateDoc(classRef, {
      studentIds,
      totalStudents: studentIds.length,
      updatedAt: serverTimestamp()
    });
    
    // Cập nhật classIds cho user
    const userRef = doc(db, 'users', studentId);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.data();
      const userClassIds = userData.classIds || [];
      
      if (!userClassIds.includes(classId)) {
        userClassIds.push(classId);
        await updateDoc(userRef, { classIds: userClassIds });
      }
    }
  }
};

/**
 * Xóa học sinh khỏi lớp
 */
export const removeStudentFromClass = async (classId: string, studentId: string): Promise<void> => {
  const classRef = doc(db, 'classes', classId);
  const classSnap = await getDoc(classRef);
  
  if (!classSnap.exists()) return;
  
  const classData = classSnap.data();
  const studentIds = (classData.studentIds || []).filter((id: string) => id !== studentId);
  
  await updateDoc(classRef, {
    studentIds,
    totalStudents: studentIds.length,
    updatedAt: serverTimestamp()
  });
  
  // Cập nhật classIds cho user
  const userRef = doc(db, 'users', studentId);
  const userSnap = await getDoc(userRef);
  
  if (userSnap.exists()) {
    const userData = userSnap.data();
    const userClassIds = (userData.classIds || []).filter((id: string) => id !== classId);
    await updateDoc(userRef, { classIds: userClassIds });
  }
};

/**
 * Xóa lớp
 */
export const deleteClass = async (classId: string): Promise<void> => {
  // Xóa tất cả học sinh khỏi lớp trước
  const classData = await getClass(classId);
  if (classData) {
    for (const studentId of classData.studentIds) {
      await removeStudentFromClass(classId, studentId);
    }
  }
  
  // Xóa tất cả join requests
  const requestsQuery = query(collection(db, 'classJoinRequests'), where('classId', '==', classId));
  const requestsSnap = await getDocs(requestsQuery);
  const deletePromises = requestsSnap.docs.map(doc => deleteDoc(doc.ref));
  await Promise.all(deletePromises);
  
  // Xóa lớp
  await deleteDoc(doc(db, 'classes', classId));
};

/**
 * Lấy danh sách học sinh trong lớp
 */
export const getStudentsInClass = async (classId: string): Promise<User[]> => {
  const classData = await getClass(classId);
  if (!classData || classData.studentIds.length === 0) return [];
  
  const students: User[] = [];
  
  for (const studentId of classData.studentIds) {
    const userRef = doc(db, 'users', studentId);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      students.push({
        id: userSnap.id,
        name: data.name || '',
        email: data.email,
        avatar: data.avatar,
        role: data.role || Role.STUDENT,
        isApproved: data.isApproved ?? true,
        createdAt: toDate(data.createdAt),
        classIds: data.classIds || []
      });
    }
  }
  
  return students;
};

// ============ EXPORTS ============
export {
  onAuthStateChanged,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot
};
// ============ SUBMISSION FUNCTIONS với HỆ THỐNG TÍNH ĐIỂM MỚI ============

/**
 * Tạo submission mới
 */
export const createSubmission = async (submission: Omit<Submission, 'id'>): Promise<string> => {
  const submissionRef = await addDoc(collection(db, 'submissions'), {
    ...submission,
    startedAt: serverTimestamp()
  });

  // ✅ Không để học sinh bị fail vì rules rooms
  try {
    const roomRef = doc(db, 'rooms', submission.roomId);
    const roomSnap = await getDoc(roomRef);
    if (roomSnap.exists()) {
      const room = roomSnap.data();
      await updateDoc(roomRef, {
        totalStudents: (room.totalStudents || 0) + 1,
        updatedAt: serverTimestamp()
      });
    }
  } catch (e) {
    console.warn('createSubmission: không update được rooms.totalStudents (có thể do rules). Bỏ qua.', e);
  }

  return submissionRef.id;
};

/**
 * ✅ SUBMIT EXAM với hệ thống tính điểm MỚI
 */
export const submitExam = async (
  submissionId: string,
  answers: { [key: number]: string },
  exam: Exam,
  antiCheatData?: {
    tabSwitchCount: number;
    tabSwitchWarnings: Date[];
    autoSubmitted: boolean;
  }
): Promise<Submission> => {
  const submissionRef = doc(db, 'submissions', submissionId);
  const submissionSnap = await getDoc(submissionRef);
  
  if (!submissionSnap.exists()) {
    throw new Error('Submission not found');
  }
  
  const submissionData = submissionSnap.data();
  
  // ✅ TÍNH ĐIỂM MỚI
  const scoreBreakdown = calculateScore(answers, exam);
  const totalScore = scoreBreakdown.totalScore;
  const percentage = scoreBreakdown.percentage;
  
  // Tính correct/wrong count
  const correctCount = getTotalCorrectCount(scoreBreakdown);
  const totalQuestions = exam.questions.length;
  const wrongCount = getTotalWrongCount(scoreBreakdown, totalQuestions);

  
  // Tính thời gian
  let startedAt: Date;
  if (submissionData.startedAt instanceof Timestamp) {
    startedAt = submissionData.startedAt.toDate();
  } else if (submissionData.startedAt) {
    startedAt = new Date(submissionData.startedAt);
  } else {
    startedAt = new Date();
  }
  
  const submittedAt = new Date();
  const duration = Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000);
  
  // ✅ Cập nhật dữ liệu
  const updatedData = {
    answers,
    scoreBreakdown,
    totalScore,
    percentage,
    score: totalScore,  // Giữ lại để tương thích
    correctCount,
    wrongCount,
    totalQuestions,
    submittedAt: serverTimestamp(),
    duration,
    status: 'submitted' as const,
    // ✅ Anti-cheat data
    tabSwitchCount: antiCheatData?.tabSwitchCount || 0,
    tabSwitchWarnings: antiCheatData?.tabSwitchWarnings || [],
    autoSubmitted: antiCheatData?.autoSubmitted || false
  };
  
  await updateDoc(submissionRef, updatedData);
  
  // Update room submitted count (✅ KHÔNG làm fail nộp bài)
  try {
    const roomRef = doc(db, 'rooms', submissionData.roomId);
    const roomSnap = await getDoc(roomRef);
    if (roomSnap.exists()) {
      const room = roomSnap.data();
      await updateDoc(roomRef, {
        submittedCount: (room.submittedCount || 0) + 1,
        updatedAt: serverTimestamp()
      });
    }
  } catch (e) {
    console.warn('submitExam: không update được rooms.submittedCount (có thể do rules). Bỏ qua.', e);
  }
  
  return {
    id: submissionId,
    roomId: submissionData.roomId,
    roomCode: submissionData.roomCode,
    examId: submissionData.examId,
    student: submissionData.student,
    answers,
    scoreBreakdown,
    totalScore,
    percentage,
    score: totalScore,
    correctCount,
    wrongCount,
    totalQuestions,
    tabSwitchCount: updatedData.tabSwitchCount,
    tabSwitchWarnings: updatedData.tabSwitchWarnings,
    autoSubmitted: updatedData.autoSubmitted,
    startedAt,
    submittedAt,
    duration,
    status: 'submitted'
  };
};

const parseSubmissionData = (id: string, data: DocumentData): Submission => {
  return {
    id,
    roomId: data.roomId || '',
    roomCode: data.roomCode || '',
    examId: data.examId || '',
    student: data.student || { id: '', name: '' },
    answers: data.answers || {},
    
    // ✅ Score breakdown mới
    scoreBreakdown: data.scoreBreakdown || {
      multipleChoice: { total: 0, correct: 0, points: 0 },
      trueFalse: { total: 0, correct: 0, partial: 0, points: 0, details: {} },
      shortAnswer: { total: 0, correct: 0, points: 0 },
      totalScore: 0,
      percentage: 0
    },
    totalScore: data.totalScore || data.score || 0,
    percentage: data.percentage || 0,
    
    // Giữ lại để tương thích
    score: data.totalScore || data.score || 0,
    correctCount: data.correctCount || 0,
    wrongCount: data.wrongCount || 0,
    totalQuestions: data.totalQuestions || 0,
    
    // ✅ Anti-cheat
    tabSwitchCount: data.tabSwitchCount || 0,
    tabSwitchWarnings: (data.tabSwitchWarnings || []).map((t: any) => 
      t instanceof Timestamp ? t.toDate() : new Date(t)
    ),
    autoSubmitted: data.autoSubmitted || false,
    
    startedAt: toDate(data.startedAt),
    submittedAt: toDate(data.submittedAt),
    duration: data.duration || 0,
    status: data.status || 'in_progress'
  };
};

export const getSubmission = async (submissionId: string): Promise<Submission | null> => {
  const submissionRef = doc(db, 'submissions', submissionId);
  const submissionSnap = await getDoc(submissionRef);
  
  if (submissionSnap.exists()) {
    return parseSubmissionData(submissionSnap.id, submissionSnap.data());
  }
  return null;
};

export const getSubmissionsByRoom = async (roomId: string): Promise<Submission[]> => {
  const q = query(
    collection(db, 'submissions'),
    where('roomId', '==', roomId)
  );
  
  const snapshot = await getDocs(q);
  const submissions = snapshot.docs.map(docSnap => 
    parseSubmissionData(docSnap.id, docSnap.data())
  );
  
  return submissions.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
};

export const getStudentSubmission = async (
  roomId: string, 
  studentId: string
): Promise<Submission | null> => {
  const q = query(
    collection(db, 'submissions'),
    where('roomId', '==', roomId),
    where('student.id', '==', studentId)
  );
  
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  
  const docSnap = snapshot.docs[0];
  return parseSubmissionData(docSnap.id, docSnap.data());
};

export const subscribeToSubmissions = (
  roomId: string, 
  callback: (submissions: Submission[]) => void
) => {
  const q = query(
    collection(db, 'submissions'),
    where('roomId', '==', roomId)
  );
  
  return onSnapshot(q, (snapshot) => {
    const submissions = snapshot.docs.map(docSnap => 
      parseSubmissionData(docSnap.id, docSnap.data())
    );
    
    submissions.sort((a, b) => {
      if ((b.totalScore || 0) !== (a.totalScore || 0)) {
        return (b.totalScore || 0) - (a.totalScore || 0);
      }
      return (b.submittedAt?.getTime() || 0) - (a.submittedAt?.getTime() || 0);
    });
    
    callback(submissions);
  });
};

// ============ EXAM FUNCTIONS (giữ nguyên) ============

export const createExam = async (examData: Omit<Exam, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  const examRef = await addDoc(collection(db, 'exams'), {
    ...examData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  
  return examRef.id;
};

export const getExam = async (examId: string): Promise<Exam | null> => {
  const examRef = doc(db, 'exams', examId);
  const examSnap = await getDoc(examRef);
  
  if (examSnap.exists()) {
    const data = examSnap.data();
    return { 
      id: examSnap.id, 
      title: data.title || '',
      description: data.description,
      timeLimit: data.timeLimit || 45,
      questions: data.questions || [],
      sections: data.sections || [],
      answers: data.answers || {},
      images: data.images,
      createdBy: data.createdBy || '',
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt)
    };
  }
  return null;
};

export const getExamsByTeacher = async (teacherId: string): Promise<Exam[]> => {
  const q = query(
    collection(db, 'exams'),
    where('createdBy', '==', teacherId)
  );
  
  const snapshot = await getDocs(q);
  const exams = snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return { 
      id: docSnap.id, 
      title: data.title || '',
      description: data.description,
      timeLimit: data.timeLimit || 45,
      questions: data.questions || [],
      sections: data.sections || [],
      answers: data.answers || {},
      images: data.images,
      createdBy: data.createdBy || '',
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt)
    };
  });
  
  exams.sort((a, b) => {
    const dateA = a.createdAt?.getTime() || 0;
    const dateB = b.createdAt?.getTime() || 0;
    return dateB - dateA;
  });
  
  return exams;
};

export const deleteExam = async (examId: string): Promise<void> => {
  await deleteDoc(doc(db, 'exams', examId));
};

// ============ ROOM FUNCTIONS (giữ nguyên) ============

const generateRoomCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const isRoomCodeUnique = async (code: string): Promise<boolean> => {
  const q = query(collection(db, 'rooms'), where('code', '==', code));
  const snapshot = await getDocs(q);
  return snapshot.empty;
};

export const createRoom = async (roomData: {
  examId: string;
  examTitle: string;
  teacherId: string;
  teacherName: string;
  timeLimit: number;
  classId?: string;    // ✅ MỚI
  className?: string;  // ✅ MỚI
  settings?: {
    allowLateJoin?: boolean;
    showResultAfterSubmit?: boolean;
    shuffleQuestions?: boolean;
    maxAttempts?: number;
  }
}): Promise<Room> => {
  let code = generateRoomCode();
  let attempts = 0;
  while (!(await isRoomCodeUnique(code)) && attempts < 10) {
    code = generateRoomCode();
    attempts++;
  }
  
  // ✅ FIX: Chỉ thêm classId/className nếu có giá trị (không undefined)
  const baseRoom = {
    code,
    examId: roomData.examId,
    examTitle: roomData.examTitle,
    teacherId: roomData.teacherId,
    teacherName: roomData.teacherName,
    status: 'waiting' as const,
    timeLimit: roomData.timeLimit,
    allowLateJoin: roomData.settings?.allowLateJoin ?? true,
    showResultAfterSubmit: roomData.settings?.showResultAfterSubmit ?? true,
    shuffleQuestions: roomData.settings?.shuffleQuestions ?? false,
    maxAttempts: roomData.settings?.maxAttempts ?? 1,
    totalStudents: 0,
    submittedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  // Chỉ thêm classId/className nếu có giá trị
  const room: Omit<Room, 'id'> = {
    ...baseRoom,
    ...(roomData.classId && { classId: roomData.classId }),
    ...(roomData.className && { className: roomData.className })
  };
  
  // Filter undefined values trước khi ghi Firestore
  const firestoreData: any = {
    ...room,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  
  // Xóa các fields undefined
  Object.keys(firestoreData).forEach(key => {
    if (firestoreData[key] === undefined) {
      delete firestoreData[key];
    }
  });
  
  const roomRef = await addDoc(collection(db, 'rooms'), firestoreData);
  
  return { id: roomRef.id, ...room };
};

const parseRoomData = (id: string, data: DocumentData): Room => {
  return {
    id,
    code: data.code || '',
    examId: data.examId || '',
    examTitle: data.examTitle || '',
    teacherId: data.teacherId || '',
    teacherName: data.teacherName || '',
    classId: data.classId,
    className: data.className,
    status: data.status || 'waiting',
    startTime: toDate(data.startTime),
    endTime: toDate(data.endTime),
    timeLimit: data.timeLimit || 45,
    allowLateJoin: data.allowLateJoin ?? true,
    showResultAfterSubmit: data.showResultAfterSubmit ?? true,
    shuffleQuestions: data.shuffleQuestions ?? false,
    maxAttempts: data.maxAttempts ?? 1,
    totalStudents: data.totalStudents || 0,
    submittedCount: data.submittedCount || 0,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
};

export const getRoomByCode = async (code: string): Promise<Room | null> => {
  const q = query(collection(db, 'rooms'), where('code', '==', code.toUpperCase()));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) return null;
  
  const docSnap = snapshot.docs[0];
  return parseRoomData(docSnap.id, docSnap.data());
};

export const getRoom = async (roomId: string): Promise<Room | null> => {
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);
  
  if (roomSnap.exists()) {
    return parseRoomData(roomSnap.id, roomSnap.data());
  }
  return null;
};

export const getRoomsByTeacher = async (teacherId: string): Promise<Room[]> => {
  const q = query(
    collection(db, 'rooms'),
    where('teacherId', '==', teacherId)
  );
  
  const snapshot = await getDocs(q);
  const rooms = snapshot.docs.map(docSnap => parseRoomData(docSnap.id, docSnap.data()));
  
  rooms.sort((a, b) => {
    const dateA = a.createdAt?.getTime() || 0;
    const dateB = b.createdAt?.getTime() || 0;
    return dateB - dateA;
  });
  
  return rooms;
};

export const updateRoomStatus = async (roomId: string, status: Room['status']): Promise<void> => {
  const roomRef = doc(db, 'rooms', roomId);
  const updateData: Record<string, unknown> = { 
    status,
    updatedAt: serverTimestamp()
  };
  
  if (status === 'active') {
    updateData.startTime = serverTimestamp();
  } else if (status === 'closed') {
    updateData.endTime = serverTimestamp();
  }
  
  await updateDoc(roomRef, updateData);
};

export const deleteRoom = async (roomId: string): Promise<void> => {
  const q = query(collection(db, 'submissions'), where('roomId', '==', roomId));
  const snapshot = await getDocs(q);
  
  const deletePromises = snapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
  await Promise.all(deletePromises);
  
  await deleteDoc(doc(db, 'rooms', roomId));
};

export const subscribeToRoom = (roomId: string, callback: (room: Room | null) => void) => {
  const roomRef = doc(db, 'rooms', roomId);
  return onSnapshot(roomRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(parseRoomData(docSnap.id, docSnap.data()));
    } else {
      callback(null);
    }
  });
};

// ============ USER MANAGEMENT (Admin) ============

export const getAllUsers = async (): Promise<User[]> => {
  const snapshot = await getDocs(collection(db, 'users'));
  return snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name || '',
      email: data.email,
      avatar: data.avatar,
      role: data.role || Role.TEACHER,
      isApproved: data.isApproved ?? false,
      createdAt: toDate(data.createdAt),
      classIds: data.classIds || []
    };
  });
};

export const getPendingUsers = async (): Promise<User[]> => {
  const q = query(
    collection(db, 'users'),
    where('isApproved', '==', false)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name || '',
      email: data.email,
      avatar: data.avatar,
      role: data.role || Role.TEACHER,
      isApproved: false,
      createdAt: toDate(data.createdAt),
      classIds: data.classIds || []
    };
  });
};

export const approveUser = async (userId: string): Promise<void> => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { isApproved: true });
};

export const rejectUser = async (userId: string): Promise<void> => {
  await deleteDoc(doc(db, 'users', userId));
};

export const updateUserRole = async (userId: string, role: Role): Promise<void> => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { role });
};

export const updateSubmission = async (
  submissionId: string, 
  data: Partial<Submission>
): Promise<void> => {
  const submissionRef = doc(db, 'submissions', submissionId);
  await updateDoc(submissionRef, data as Record<string, unknown>);
};
