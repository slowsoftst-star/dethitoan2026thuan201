import React, { useState, useEffect } from 'react';
import { User, Role, Room, StudentInfo, Submission } from '../types';
import { 
  auth, 
  signInStudentWithGoogle, 
  signOutUser,
  getRoomByCode, 
  getStudentSubmission,
  getCurrentUser 
} from '../services/firebaseService';

interface StudentPortalProps {
  onJoinRoom: (room: Room, student: StudentInfo, submissionId?: string) => void;
}

/**
 * StudentPortal - PHIÊN BẢN MỚI
 * 
 * Yêu cầu:
 * 1. Học sinh PHẢI đăng nhập Google
 * 2. Admin phải duyệt
 * 3. Học sinh phải được thêm vào lớp
 * 4. Chỉ học sinh đã duyệt mới vào phòng được
 */

const StudentPortal: React.FC<StudentPortalProps> = ({ onJoinRoom }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  // Check auth state
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const user = await getCurrentUser();
          setCurrentUser(user);
        } catch (err) {
          console.error('Get user error:', err);
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Handle Google login
  const handleGoogleLogin = async () => {
    try {
      // ✅ Cổng học sinh: luôn dùng luồng đăng nhập học sinh
      const user = await signInStudentWithGoogle();
      if (user) {
        setCurrentUser(user);
      }
    } catch (err) {
      console.error('Login error:', err);
      alert('Đăng nhập thất bại. Vui lòng thử lại.');
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await signOutUser();
      setCurrentUser(null);
      setRoomCode('');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Handle join room
  const handleJoinRoom = async () => {
    if (!roomCode.trim()) {
      alert('⚠️ Vui lòng nhập mã phòng!');
      return;
    }

    if (!currentUser) {
      alert('⚠️ Vui lòng đăng nhập trước!');
      return;
    }

    // ✅ Chặn nhầm tài khoản giáo viên vào cổng học sinh
    if (currentUser.role !== Role.STUDENT) {
      alert('⚠️ Tài khoản này không phải HỌC SINH.\n\nVui lòng đăng xuất và đăng nhập ở Cổng Giáo viên.');
      return;
    }

    // ✅ KIỂM TRA: Học sinh đã được duyệt chưa?
    if (!currentUser.isApproved) {
      alert('⚠️ Tài khoản của bạn chưa được Admin duyệt!\n\nVui lòng chờ Admin duyệt tài khoản.');
      return;
    }

    // ✅ KIỂM TRA: Học sinh có trong lớp nào không?
    if (!currentUser.classIds || currentUser.classIds.length === 0) {
      alert('⚠️ Bạn chưa được thêm vào lớp nào!\n\nVui lòng liên hệ giáo viên để được thêm vào lớp.');
      return;
    }

    setIsJoining(true);

    try {
      const room = await getRoomByCode(roomCode.trim().toUpperCase());

      if (!room) {
        alert('❌ Không tìm thấy phòng thi với mã này!');
        setIsJoining(false);
        return;
      }

      if (room.status === 'closed') {
        alert('❌ Phòng thi đã đóng!');
        setIsJoining(false);
        return;
      }

      if (room.status === 'waiting' && !room.allowLateJoin) {
        alert('❌ Phòng thi chưa bắt đầu!');
        setIsJoining(false);
        return;
      }

      // ✅ KIỂM TRA: Học sinh có trong lớp của phòng thi không?
      if (room.classId) {
        if (!currentUser.classIds?.includes(room.classId)) {
          alert(`❌ Bạn không thuộc lớp "${room.className || 'này'}"!\n\nPhòng thi này chỉ dành cho học sinh trong lớp.`);
          setIsJoining(false);
          return;
        }
      }

      // Tạo StudentInfo từ User
      const studentInfo: StudentInfo = {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        className: currentUser.classIds[0] // Lấy lớp đầu tiên
      };

      // Check existing submission
      const existingSubmission = await getStudentSubmission(room.id, currentUser.id);

      if (existingSubmission) {
        if (existingSubmission.status === 'submitted') {
          alert('✅ Bạn đã nộp bài rồi!\n\nKhông thể làm lại.');
          setIsJoining(false);
          return;
        }

        // Tiếp tục làm bài
        onJoinRoom(room, studentInfo, existingSubmission.id);
      } else {
        // Bắt đầu làm bài mới
        onJoinRoom(room, studentInfo);
      }
    } catch (err) {
      console.error('Join room error:', err);
      alert('❌ Có lỗi xảy ra. Vui lòng thử lại!');
    } finally {
      setIsJoining(false);
    }
  };

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-teal-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-teal-700">Đang kiểm tra...</p>
        </div>
      </div>
    );
  }

  // Chưa đăng nhập
  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-teal-50 to-green-50 p-4">
        <div className="max-w-md w-full">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="text-7xl mb-4">🎓</div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Cổng Học Sinh</h1>
            <p className="text-gray-600">Đăng nhập để vào phòng thi</p>
          </div>

          {/* Login Card */}
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">📝 Yêu cầu đăng nhập</h2>
            
            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Đăng nhập bằng tài khoản Google</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Chờ Admin duyệt tài khoản</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Giáo viên thêm bạn vào lớp</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-teal-500">✓</span>
                <p>Nhập mã phòng để vào thi</p>
              </div>
            </div>

            <button
              onClick={handleGoogleLogin}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition transform hover:scale-105 flex items-center justify-center gap-3"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Đăng nhập với Google
            </button>

            <p className="text-center text-sm text-gray-500 mt-4">
              Lần đầu đăng nhập? Tài khoản sẽ được tạo tự động
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Đã đăng nhập nhưng chưa được duyệt
  if (!currentUser.isApproved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">⏳</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Chờ duyệt tài khoản</h2>
            </div>

            {/* User Info */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="flex items-center gap-3 mb-3">
                {currentUser.avatar ? (
                  <img src={currentUser.avatar} alt="" className="w-12 h-12 rounded-full" />
                ) : (
                  <div className="w-12 h-12 bg-teal-500 rounded-full flex items-center justify-center text-white text-xl font-bold">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-bold text-gray-800">{currentUser.name}</p>
                  <p className="text-sm text-gray-500">{currentUser.email}</p>
                </div>
              </div>
              <div className="px-3 py-2 bg-yellow-100 border border-yellow-300 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>🔒 Trạng thái:</strong> Chờ Admin duyệt
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-green-500">✓</span>
                <p>Tài khoản đã được tạo</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <span className="text-yellow-500">⏳</span>
                <p><strong>Đang chờ Admin duyệt...</strong></p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-400">
                <span>○</span>
                <p>Được thêm vào lớp</p>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-400">
                <span>○</span>
                <p>Vào phòng thi</p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-blue-800">
                💡 <strong>Thời gian chờ:</strong> Thường dưới 24 giờ. Vui lòng quay lại sau hoặc liên hệ giáo viên.
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="w-full py-3 border-2 border-gray-300 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 transition"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Đã đăng nhập và đã được duyệt
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-blue-50 to-purple-50 p-4">
      <div className="max-w-2xl mx-auto pt-12">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-2xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {currentUser.avatar ? (
                <img src={currentUser.avatar} alt="" className="w-16 h-16 rounded-full" />
              ) : (
                <div className="w-16 h-16 bg-teal-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h2 className="text-xl font-bold text-gray-800">{currentUser.name}</h2>
                <p className="text-sm text-gray-500">{currentUser.email}</p>
                {currentUser.classIds && currentUser.classIds.length > 0 && (
                  <p className="text-sm text-teal-600 mt-1">
                    📚 {currentUser.classIds.length} lớp học
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition text-sm"
            >
              Đăng xuất
            </button>
          </div>

          {/* Status Badge */}
          <div className="mt-4 flex gap-2">
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
              ✓ Đã duyệt
            </span>
            {currentUser.classIds && currentUser.classIds.length > 0 && (
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                ✓ Có lớp học
              </span>
            )}
          </div>
        </div>

        {/* Join Room Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🏠</div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Vào Phòng Thi</h1>
            <p className="text-gray-600">Nhập mã phòng để bắt đầu làm bài</p>
          </div>

          {/* Room Code Input */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              🔑 Mã phòng (6 ký tự)
            </label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
              placeholder="VD: ABC123"
              maxLength={6}
              className="w-full px-4 py-4 text-2xl text-center font-mono font-bold border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:ring-4 focus:ring-teal-200 focus:outline-none uppercase tracking-widest"
              disabled={isJoining}
            />
          </div>

          {/* Join Button */}
          <button
            onClick={handleJoinRoom}
            disabled={isJoining || !roomCode.trim()}
            className="w-full bg-gradient-to-r from-teal-500 to-teal-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {isJoining ? '⏳ Đang kiểm tra...' : '🚀 Vào Phòng Thi'}
          </button>

          {/* Info */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm text-blue-800">
              💡 <strong>Lưu ý:</strong> Chỉ vào được phòng thi của lớp bạn đang học.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentPortal;
