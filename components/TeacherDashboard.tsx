import React, { useState, useEffect } from 'react';
import { User, Exam, Room, Submission, Class } from '../types';
import { 
  createExam, 
  getExamsByTeacher, 
  deleteExam,
  createRoom, 
  getRoomsByTeacher, 
  updateRoomStatus,
  deleteRoom,
  subscribeToSubmissions,
  getExam,
  // ✅ MỚI: Class management
  createClass,
  getClassesByTeacher,
  getStudentsInClass,
  deleteClass,
  addStudentToClass,
  removeStudentFromClass
} from '../services/firebaseService';
import { parseWordToExam, validateExamData } from '../services/mathWordParserService';
import SubmissionDetailView from './SubmissionDetailView';
import { formatScore } from '../services/scoringService';

interface TeacherDashboardProps {
  user: User;
  onLogout: () => void;
}

type Tab = 'exams' | 'rooms' | 'results' | 'classes';

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<Tab>('exams');
  const [exams, setExams] = useState<Exam[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  // Room creation modal
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [selectedExamForRoom, setSelectedExamForRoom] = useState<Exam | null>(null);
  const [roomTimeLimit, setRoomTimeLimit] = useState(45);
  const [selectedClassForRoom, setSelectedClassForRoom] = useState<string>('');
  
  // Class management
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassGrade, setNewClassGrade] = useState('');
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [classStudents, setClassStudents] = useState<User[]>([]);
  
  // Results view
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [currentExam, setCurrentExam] = useState<Exam | null>(null);

  // Load data
  useEffect(() => {
    loadData();
  }, [user.id]);

  // Subscribe to submissions when a room is selected
  useEffect(() => {
    if (selectedRoom) {
      const unsubscribe = subscribeToSubmissions(selectedRoom.id, (subs) => {
        setSubmissions(subs);
      });
      
      // Load exam for detail view
      loadExamForRoom(selectedRoom.examId);
      
      return () => unsubscribe();
    }
  }, [selectedRoom]);

  // Load students when class is selected
  useEffect(() => {
    if (selectedClass) {
      loadClassStudents(selectedClass.id);
    }
  }, [selectedClass]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [examsList, roomsList, classesList] = await Promise.all([
        getExamsByTeacher(user.id),
        getRoomsByTeacher(user.id),
        getClassesByTeacher(user.id)
      ]);
      setExams(examsList);
      setRooms(roomsList);
      setClasses(classesList);
    } catch (err) {
      console.error('Load data error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadExamForRoom = async (examId: string) => {
    try {
      const exam = await getExam(examId);
      setCurrentExam(exam);
    } catch (err) {
      console.error('Load exam error:', err);
    }
  };

  const loadClassStudents = async (classId: string) => {
    try {
      const students = await getStudentsInClass(classId);
      setClassStudents(students);
    } catch (err) {
      console.error('Load students error:', err);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.docx')) {
      alert('⚠️ Vui lòng chọn file Word (.docx)');
      return;
    }

    setIsUploading(true);
    try {
      const examData = await parseWordToExam(file);
      const validation = validateExamData(examData);
      
      if (!validation.valid && examData.questions.length === 0) {
        alert('❌ File không hợp lệ:\n' + validation.errors.join('\n'));
        setIsUploading(false);
        return;
      }

      if (validation.errors.length > 0) {
        console.warn('⚠️ Warnings:', validation.errors);
      }

      const examId = await createExam({
        title: file.name.replace('.docx', ''),
        description: `${examData.questions.length} câu hỏi • Môn Toán`,
        timeLimit: examData.timeLimit || 90,
        questions: examData.questions,
        sections: examData.sections,
        answers: examData.answers,
        createdBy: user.id,
        images: examData.images || []
      });

      const mcCount = examData.questions.filter(q => q.type === 'multiple_choice').length;
      const tfCount = examData.questions.filter(q => q.type === 'true_false').length;
      const saCount = examData.questions.filter(q => q.type === 'short_answer').length;
      const imgCount = examData.images?.length || 0;
      
      alert(
        `✅ Đã tải lên đề thi thành công!\n\n` +
        `📊 Thống kê:\n` +
        `• Tổng: ${examData.questions.length} câu hỏi\n` +
        `• Trắc nghiệm: ${mcCount} câu\n` +
        `• Đúng/Sai: ${tfCount} câu\n` +
        `• Trả lời ngắn: ${saCount} câu\n` +
        `• Hình ảnh: ${imgCount} ảnh`
      );
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      await loadData();
    } catch (err) {
      console.error('Upload error:', err);
      alert('❌ Lỗi khi tải lên. Vui lòng thử lại.\n\n' + (err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateClass = async () => {
    if (!newClassName.trim()) {
      alert('⚠️ Vui lòng nhập tên lớp!');
      return;
    }

    try {
      await createClass({
        name: newClassName,
        grade: newClassGrade,
        subject: 'Toán',
        teacherId: user.id,
        teacherName: user.name
      });

      alert(`✅ Đã tạo lớp "${newClassName}" thành công!`);
      setShowCreateClass(false);
      setNewClassName('');
      setNewClassGrade('');
      loadData();
    } catch (err) {
      console.error('Create class error:', err);
      alert('❌ Lỗi khi tạo lớp');
    }
  };

  const handleDeleteClass = async (classId: string, className: string) => {
    if (!confirm(`Bạn có chắc muốn xóa lớp "${className}"? Tất cả học sinh sẽ bị xóa khỏi lớp.`)) return;

    try {
      await deleteClass(classId);
      alert('✅ Đã xóa lớp!');
      loadData();
    } catch (err) {
      console.error('Delete class error:', err);
      alert('❌ Lỗi khi xóa lớp');
    }
  };

  const handleCreateRoom = async () => {
    if (!selectedExamForRoom) return;

    try {
      const selectedClassData = selectedClassForRoom 
        ? classes.find(c => c.id === selectedClassForRoom)
        : null;

      const newRoom = await createRoom({
        examId: selectedExamForRoom.id,
        examTitle: selectedExamForRoom.title,
        teacherId: user.id,
        teacherName: user.name,
        timeLimit: roomTimeLimit,
        classId: selectedClassData?.id,
        className: selectedClassData?.name,
        settings: {
          allowLateJoin: true,
          showResultAfterSubmit: true,
          shuffleQuestions: false,
          maxAttempts: 1
        }
      });

      alert(
        `✅ Đã tạo phòng thi!\n\n` +
        `Mã phòng: ${newRoom.code}\n` +
        `${selectedClassData ? `Lớp: ${selectedClassData.name}\n` : ''}` +
        `\nChia sẻ mã này cho học sinh.`
      );
      setShowCreateRoom(false);
      setSelectedExamForRoom(null);
      setSelectedClassForRoom('');
      loadData();
    } catch (err) {
      console.error('Create room error:', err);
      alert('❌ Lỗi khi tạo phòng thi');
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!confirm('Bạn có chắc muốn xóa đề thi này?')) return;
    
    try {
      await deleteExam(examId);
      loadData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleRoomAction = async (roomId: string, action: 'start' | 'close' | 'delete') => {
    try {
      if (action === 'delete') {
        if (!confirm('Bạn có chắc muốn xóa phòng thi này? Tất cả bài làm sẽ bị xóa.')) return;
        await deleteRoom(roomId);
      } else {
        await updateRoomStatus(roomId, action === 'start' ? 'active' : 'closed');
      }
      loadData();
    } catch (err) {
      console.error('Room action error:', err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('✅ Đã copy mã phòng: ' + text);
  };

  const getQuestionTypeCounts = (exam: Exam) => {
    const mc = exam.questions.filter(q => q.type === 'multiple_choice').length;
    const tf = exam.questions.filter(q => q.type === 'true_false').length;
    const sa = exam.questions.filter(q => q.type === 'short_answer').length;
    return { mc, tf, sa };
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div 
        className="text-white p-4 shadow-lg"
        style={{ background: 'linear-gradient(135deg, #0d9488 0%, #115e59 100%)' }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-3xl">👨‍🏫</div>
            <div>
              <h1 className="text-xl font-bold">Teacher Dashboard</h1>
              <p className="text-teal-100 text-sm">{user.name}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition"
          >
            Đăng xuất
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex gap-2 mb-6">
          {[
            { id: 'exams', label: '📚 Đề thi', count: exams.length },
            { id: 'rooms', label: '🏠 Phòng thi', count: rooms.length },
            { id: 'results', label: '📊 Kết quả', count: rooms.filter(r => r.submittedCount > 0).length },
            { id: 'classes', label: '👥 Lớp học', count: classes.length }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`px-6 py-3 rounded-xl font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-teal-600 text-white shadow-lg'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              <span className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-sm">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Đang tải...</p>
          </div>
        ) : (
          <>
            {/* Tab: Exams */}
            {activeTab === 'exams' && (
              <div>
                {/* Upload Button */}
                <div className="bg-white rounded-2xl p-6 shadow-lg mb-6">
                  <h3 className="font-bold text-gray-800 mb-4">📤 Tải lên đề thi mới (Môn Toán)</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Hỗ trợ file Word (.docx) với công thức LaTeX ($...$) và 3 loại câu hỏi: Trắc nghiệm, Đúng/Sai, Trả lời ngắn
                  </p>
                  <input
                    type="file"
                    accept=".docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                    className="hidden"
                    id="upload-exam"
                    disabled={isUploading}
                  />
                  <label
                    htmlFor="upload-exam"
                    className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold cursor-pointer transition ${
                      isUploading 
                        ? 'bg-gray-300 cursor-not-allowed' 
                        : 'bg-teal-600 text-white hover:bg-teal-700'
                    }`}
                  >
                    {isUploading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        Đang xử lý...
                      </>
                    ) : (
                      <>📂 Chọn file Word (.docx)</>
                    )}
                  </label>
                </div>

                {/* Exams List */}
                <div className="grid gap-4">
                  {exams.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center">
                      <div className="text-6xl mb-4">📝</div>
                      <p className="text-gray-500">Chưa có đề thi nào. Hãy tải lên đề thi đầu tiên!</p>
                    </div>
                  ) : (
                    exams.map(exam => {
                      const counts = getQuestionTypeCounts(exam);
                      return (
                        <div key={exam.id} className="bg-white rounded-xl p-5 shadow-md hover:shadow-lg transition">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center text-2xl">
                                📄
                              </div>
                              <div>
                                <h3 className="font-bold text-gray-800">{exam.title}</h3>
                                <p className="text-sm text-gray-500">
                                  {exam.questions.length} câu • {exam.timeLimit} phút
                                </p>
                                <div className="flex gap-2 mt-1">
                                  {counts.mc > 0 && (
                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                      TN: {counts.mc}
                                    </span>
                                  )}
                                  {counts.tf > 0 && (
                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                      Đ/S: {counts.tf}
                                    </span>
                                  )}
                                  {counts.sa > 0 && (
                                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                                      TLN: {counts.sa}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSelectedExamForRoom(exam);
                                  setShowCreateRoom(true);
                                }}
                                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition text-sm font-medium"
                              >
                                🏠 Tạo phòng
                              </button>
                              <button
                                onClick={() => handleDeleteExam(exam.id)}
                                className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition text-sm font-medium"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Tab: Rooms */}
            {activeTab === 'rooms' && (
              <div className="grid gap-4">
                {rooms.length === 0 ? (
                  <div className="bg-white rounded-2xl p-12 text-center">
                    <div className="text-6xl mb-4">🏠</div>
                    <p className="text-gray-500">Chưa có phòng thi nào. Tạo phòng từ đề thi!</p>
                  </div>
                ) : (
                  rooms.map(room => (
                    <div key={room.id} className="bg-white rounded-xl p-5 shadow-md">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                            room.status === 'active' ? 'bg-green-100' :
                            room.status === 'closed' ? 'bg-gray-100' : 'bg-yellow-100'
                          }`}>
                            {room.status === 'active' ? '🟢' : room.status === 'closed' ? '🔴' : '🟡'}
                          </div>
                          <div>
                            <h3 className="font-bold text-gray-800">{room.examTitle}</h3>
                            <div className="flex items-center gap-3 text-sm text-gray-500">
                              <span 
                                className="font-mono font-bold text-lg text-teal-600 cursor-pointer hover:text-teal-800"
                                onClick={() => copyToClipboard(room.code)}
                                title="Click để copy"
                              >
                                📋 {room.code}
                              </span>
                              {room.className && (
                                <>
                                  <span>•</span>
                                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                                    {room.className}
                                  </span>
                                </>
                              )}
                              <span>•</span>
                              <span>{room.timeLimit} phút</span>
                              <span>•</span>
                              <span>{room.submittedCount}/{room.totalStudents} đã nộp</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                            room.status === 'active' ? 'bg-green-100 text-green-700' :
                            room.status === 'closed' ? 'bg-gray-100 text-gray-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {room.status === 'active' ? 'Đang thi' : 
                             room.status === 'closed' ? 'Đã đóng' : 'Chờ bắt đầu'}
                          </span>

                          {room.status === 'waiting' && (
                            <button
                              onClick={() => handleRoomAction(room.id, 'start')}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
                            >
                              ▶️ Bắt đầu
                            </button>
                          )}
                          {room.status === 'active' && (
                            <button
                              onClick={() => handleRoomAction(room.id, 'close')}
                              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
                            >
                              ⏹️ Đóng phòng
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectedRoom(room);
                              setActiveTab('results');
                            }}
                            className="px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition text-sm font-medium"
                          >
                            📊 Kết quả
                          </button>
                          <button
                            onClick={() => handleRoomAction(room.id, 'delete')}
                            className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition text-sm font-medium"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab: Results */}
            {activeTab === 'results' && (
              <div>
                {/* Room Selector */}
                <div className="bg-white rounded-xl p-4 mb-6 shadow-md">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Chọn phòng thi:
                  </label>
                  <select
                    value={selectedRoom?.id || ''}
                    onChange={(e) => {
                      const room = rooms.find(r => r.id === e.target.value);
                      setSelectedRoom(room || null);
                    }}
                    className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
                  >
                    <option value="">-- Chọn phòng --</option>
                    {rooms.map(room => (
                      <option key={room.id} value={room.id}>
                        {room.code} - {room.examTitle} ({room.submittedCount} bài nộp)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Results Table */}
                {selectedRoom && (
                  <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    <div className="p-4 bg-teal-600 text-white">
                      <h3 className="font-bold">
                        📊 Kết quả: {selectedRoom.examTitle}
                      </h3>
                      <p className="text-sm text-teal-100">
                        Mã phòng: {selectedRoom.code} • {submissions.length} bài nộp
                      </p>
                    </div>

                    {submissions.length === 0 ? (
                      <div className="p-12 text-center">
                        <div className="text-5xl mb-4">🔭</div>
                        <p className="text-gray-500">Chưa có học sinh nào nộp bài</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">STT</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Họ tên</th>
                              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Lớp</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Điểm</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Phần trăm</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Đúng/Tổng</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Thời gian</th>
                              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Hành động</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {submissions.map((sub, idx) => (
                              <tr key={sub.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm">{idx + 1}</td>
                                <td className="px-4 py-3 font-medium">
                                  {sub.student.name}
                                  {sub.tabSwitchCount > 0 && (
                                    <span className="ml-2 text-xs text-red-600" title="Có chuyển tab">
                                      ⚠️{sub.tabSwitchCount}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">{sub.student.className || '-'}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`font-bold text-lg ${
                                    sub.totalScore >= 8 ? 'text-green-600' :
                                    sub.totalScore >= 5 ? 'text-yellow-600' : 'text-red-600'
                                  }`}>
                                    {formatScore(sub.totalScore)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center text-sm">
                                  <span className="font-semibold">{sub.percentage}%</span>
                                </td>
                                <td className="px-4 py-3 text-center text-sm">
                                  <span className="text-green-600 font-medium">{sub.correctCount}</span>
                                  <span className="text-gray-400">/{sub.totalQuestions}</span>
                                </td>
                                <td className="px-4 py-3 text-center text-sm text-gray-600">
                                  {Math.floor(sub.duration / 60)}:{(sub.duration % 60).toString().padStart(2, '0')}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <button
                                    onClick={() => setSelectedSubmission(sub)}
                                    className="px-3 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 text-sm font-medium"
                                  >
                                    👁️ Chi tiết
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Summary Stats */}
                    {submissions.length > 0 && (
                      <div className="p-4 bg-gray-50 border-t">
                        <div className="grid grid-cols-4 gap-4 text-center">
                          <div>
                            <div className="text-2xl font-bold text-teal-600">
                              {submissions.length}
                            </div>
                            <div className="text-sm text-gray-500">Tổng bài nộp</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-green-600">
                              {formatScore(submissions.reduce((acc, s) => acc + s.totalScore, 0) / submissions.length)}
                            </div>
                            <div className="text-sm text-gray-500">Điểm TB</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-blue-600">
                              {formatScore(Math.max(...submissions.map(s => s.totalScore)))}
                            </div>
                            <div className="text-sm text-gray-500">Cao nhất</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-orange-600">
                              {formatScore(Math.min(...submissions.map(s => s.totalScore)))}
                            </div>
                            <div className="text-sm text-gray-500">Thấp nhất</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Classes */}
            {activeTab === 'classes' && (
              <div>
                {/* Create Class Button */}
                <div className="mb-6">
                  <button
                    onClick={() => setShowCreateClass(true)}
                    className="px-6 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition"
                  >
                    ➕ Tạo lớp mới
                  </button>
                </div>

                {/* Classes Grid */}
                <div className="grid gap-4">
                  {classes.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 text-center">
                      <div className="text-6xl mb-4">👥</div>
                      <p className="text-gray-500">Chưa có lớp học nào. Hãy tạo lớp đầu tiên!</p>
                    </div>
                  ) : (
                    classes.map(cls => (
                      <div key={cls.id} className="bg-white rounded-xl p-5 shadow-md hover:shadow-lg transition">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-2xl">
                              🎓
                            </div>
                            <div>
                              <h3 className="font-bold text-gray-800 text-lg">{cls.name}</h3>
                              <p className="text-sm text-gray-500">
                                {cls.grade && `Khối ${cls.grade} • `}
                                {cls.totalStudents} học sinh
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setSelectedClass(cls)}
                              className="px-4 py-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition text-sm font-medium"
                            >
                              👥 Xem học sinh
                            </button>
                            <button
                              onClick={() => handleDeleteClass(cls.id, cls.name)}
                              className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition text-sm font-medium"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Room Modal */}
      {showCreateRoom && selectedExamForRoom && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 mb-4">🏠 Tạo phòng thi</h3>
            
            <div className="bg-teal-50 rounded-xl p-4 mb-4">
              <p className="text-sm text-teal-600">Đề thi:</p>
              <p className="font-bold text-teal-900">{selectedExamForRoom.title}</p>
              <p className="text-sm text-teal-600">{selectedExamForRoom.questions.length} câu hỏi</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ⏱️ Thời gian làm bài (phút):
              </label>
              <input
                type="number"
                value={roomTimeLimit}
                onChange={(e) => setRoomTimeLimit(parseInt(e.target.value) || 45)}
                min={5}
                max={180}
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                👥 Chọn lớp (tùy chọn):
              </label>
              <select
                value={selectedClassForRoom}
                onChange={(e) => setSelectedClassForRoom(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              >
                <option value="">-- Tất cả học sinh --</option>
                {classes.map(cls => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name} ({cls.totalStudents} HS)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateRoom(false);
                  setSelectedExamForRoom(null);
                  setSelectedClassForRoom('');
                }}
                className="flex-1 py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateRoom}
                className="flex-1 py-3 rounded-xl font-bold text-white transition"
                style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)' }}
              >
                ✓ Tạo phòng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Class Modal */}
      {showCreateClass && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 mb-4">🎓 Tạo lớp mới</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tên lớp: <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="VD: 10A1, Toán 11, ..."
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Khối (tùy chọn):
              </label>
              <select
                value={newClassGrade}
                onChange={(e) => setNewClassGrade(e.target.value)}
                className="w-full p-3 border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:outline-none"
              >
                <option value="">-- Chọn khối --</option>
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateClass(false);
                  setNewClassName('');
                  setNewClassGrade('');
                }}
                className="flex-1 py-3 rounded-xl font-semibold border-2 border-gray-300 hover:bg-gray-50 transition"
              >
                Hủy
              </button>
              <button
                onClick={handleCreateClass}
                className="flex-1 py-3 rounded-xl font-bold text-white transition"
                style={{ background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)' }}
              >
                ✓ Tạo lớp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Class Students Modal */}
      {selectedClass && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-purple-600 text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">{selectedClass.name}</h3>
                  <p className="text-purple-100 text-sm">{classStudents.length} học sinh</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedClass(null);
                    setClassStudents([]);
                  }}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6">
              {classStudents.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-5xl mb-4">👥</div>
                  <p className="text-gray-500">Chưa có học sinh trong lớp</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {classStudents.map((student, idx) => (
                    <div key={student.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 bg-purple-500 text-white rounded-full flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        {student.avatar ? (
                          <img src={student.avatar} alt="" className="w-10 h-10 rounded-full" />
                        ) : (
                          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center font-bold">
                            {student.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold">{student.name}</p>
                          <p className="text-sm text-gray-500">{student.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(`Xóa ${student.name} khỏi lớp?`)) {
                            removeStudentFromClass(selectedClass.id, student.id).then(() => {
                              loadClassStudents(selectedClass.id);
                              loadData();
                            });
                          }
                        }}
                        className="px-3 py-1 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 text-sm"
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submission Detail View */}
      {selectedSubmission && currentExam && (
        <SubmissionDetailView
          submission={selectedSubmission}
          exam={currentExam}
          onClose={() => setSelectedSubmission(null)}
        />
      )}
    </div>
  );
};

export default TeacherDashboard;
