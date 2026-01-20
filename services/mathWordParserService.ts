import JSZip from 'jszip';
import { ExamData, Question, QuestionOption, ExamSection, ImageData } from '../types';

/**
 * ============================================================
 * MATH WORD PARSER SERVICE - VERSION 7 (UNDERLINE DETECTION)
 * 
 * CẢI TIẾN: Detect đáp án đúng từ text gạch chân (underline)
 * 
 * Hỗ trợ 3 cách xác định đáp án đúng (theo thứ tự ưu tiên):
 * 1. "Chọn X" trong lời giải
 * 2. "Đáp án: X" 
 * 3. Option có text gạch chân (underline) - MỚI!
 * 
 * Hỗ trợ detect underline từ:
 * - Word XML: <w:u> tag
 * - Markdown format: [X]{.underline}
 * ============================================================
 */

// Types
type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer' | 'writing' | 'unknown';

interface ParsedQuestion {
  number: number;
  globalIndex: number;
  part: number;
  type: QuestionType;
  text: string;
  options: QuestionOption[];
  correctAnswer: string | null;
  solution: string;
  images: ImageData[];
}

// CẢI TIẾN: Thêm field để track underline
interface ParagraphData {
  text: string;
  imageRIds: string[];
  hasUnderline: boolean;           // Có text gạch chân không
  underlinedSegments: string[];    // Các đoạn text được gạch chân
}

// ============================================================
// TEXT NORMALIZATION
// ============================================================

function normalizeVietnamese(text: string): string {
  if (!text) return '';
  text = text.normalize('NFC');
  return text;
}

function normalizeLatex(text: string): string {
  if (!text) return '';
  
  // Convert \[...\] → $$...$$
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$1$$');
  
  // Convert \(...\) → $...$
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
  
  // Fix multiple consecutive $ signs
  text = text.replace(/\${3,}/g, '$$');
  
  // Fix double spaces
  text = text.replace(/\s+/g, ' ');
  
  return text.trim();
}

function escapeHtmlPreserveLaTeX(text: string): string {
  if (!text) return '';
  
  const latexBlocks: string[] = [];
  
  const protectLatex = (match: string): string => {
    latexBlocks.push(match);
    return `__LATEX_BLOCK_${latexBlocks.length - 1}__`;
  };
  
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, protectLatex);
  text = text.replace(/\$(?!\$)([\s\S]*?)\$(?!\$)/g, protectLatex);
  
  text = text.replace(/&/g, '&amp;');
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');
  
  for (let i = 0; i < latexBlocks.length; i++) {
    text = text.replace(`__LATEX_BLOCK_${i}__`, latexBlocks[i]);
  }
  
  return text;
}

// ============================================================
// MAIN EXPORT FUNCTION
// ============================================================

export const parseWordToExam = async (file: File): Promise<ExamData> => {
  console.log('📄 Parsing Word file:', file.name);
  
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  
  // 1. Trích xuất hình ảnh
  const { images, imageRelMap } = await extractImages(zip);
  console.log('🖼️ Extracted images:', images.length);
  
  // 2. Parse document.xml
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    throw new Error('Không tìm thấy document.xml trong file Word');
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(documentXml, 'application/xml');
  
  // 3. Trích xuất paragraphs với hình ảnh VÀ UNDERLINE
  const paragraphs = extractParagraphsWithUnderline(xmlDoc, imageRelMap);
  console.log('📝 Total paragraphs:', paragraphs.length);
  
  // 4. Parse questions theo sections
  const examData = parseAllQuestions(paragraphs, images);
  
  // 5. Set metadata
  examData.title = file.name.replace('.docx', '');
  examData.images = images;
  
  console.log('✅ Parsed questions:', examData.questions.length);
  console.log('📊 Sections:', examData.sections.length);
  
  return examData;
};

// ============================================================
// EXTRACT IMAGES (giữ nguyên)
// ============================================================

async function extractImages(zip: JSZip): Promise<{
  images: ImageData[];
  imageRelMap: Map<string, string>;
}> {
  const images: ImageData[] = [];
  const imageRelMap = new Map<string, string>();
  
  try {
    const relsContent = await zip.file('word/_rels/document.xml.rels')?.async('string');
    if (relsContent) {
      const relPattern = /Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
      let match;
      while ((match = relPattern.exec(relsContent)) !== null) {
        const rId = match[1];
        const target = match[2];
        if (target.includes('media/')) {
          const filename = target.split('/').pop() || '';
          imageRelMap.set(rId, filename);
        }
      }
    }
    
    for (const [path, zipEntry] of Object.entries(zip.files)) {
      if (path.startsWith('word/media/') && !zipEntry.dir) {
        const filename = path.split('/').pop() || '';
        const data = await zipEntry.async('base64');
        
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const contentTypes: { [key: string]: string } = {
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'webp': 'image/webp',
          'bmp': 'image/bmp'
        };
        
        let rId = '';
        for (const [rid, fname] of imageRelMap.entries()) {
          if (fname === filename) {
            rId = rid;
            break;
          }
        }
        
        images.push({
          id: `img_${images.length}`,
          filename,
          base64: data,
          contentType: contentTypes[ext] || 'image/png',
          rId
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ Error extracting images:', err);
  }
  
  return { images, imageRelMap };
}

// ============================================================
// CẢI TIẾN: EXTRACT PARAGRAPHS VỚI UNDERLINE DETECTION
// ============================================================

function extractParagraphsWithUnderline(xmlDoc: Document, imageRelMap: Map<string, string>): ParagraphData[] {
  const paragraphs: ParagraphData[] = [];
  const pElements = xmlDoc.getElementsByTagName('w:p');
  
  for (let i = 0; i < pElements.length; i++) {
    const p = pElements[i];
    let text = '';
    const imageRIds: string[] = [];
    let hasUnderline = false;
    const underlinedSegments: string[] = [];
    
    const runs = p.getElementsByTagName('w:r');
    for (let j = 0; j < runs.length; j++) {
      const run = runs[j];
      
      // Check for images
      const blips = run.getElementsByTagName('a:blip');
      for (let k = 0; k < blips.length; k++) {
        const embed = blips[k].getAttribute('r:embed');
        if (embed) {
          imageRIds.push(embed);
        }
      }
      
      const vImageData = run.getElementsByTagName('v:imagedata');
      for (let k = 0; k < vImageData.length; k++) {
        const rid = vImageData[k].getAttribute('r:id') || vImageData[k].getAttribute('o:relid');
        if (rid) {
          imageRIds.push(rid);
        }
      }
      
      const drawings = run.getElementsByTagName('w:drawing');
      for (let k = 0; k < drawings.length; k++) {
        const innerBlips = drawings[k].getElementsByTagName('a:blip');
        for (let l = 0; l < innerBlips.length; l++) {
          const embed = innerBlips[l].getAttribute('r:embed');
          if (embed && !imageRIds.includes(embed)) {
            imageRIds.push(embed);
          }
        }
      }
      
      // CẢI TIẾN: Detect underline từ <w:u> tag trong <w:rPr>
      const rPr = run.getElementsByTagName('w:rPr')[0];
      const isUnderlined = rPr ? rPr.getElementsByTagName('w:u').length > 0 : false;
      
      // Extract text
      let runText = '';
      const textNodes = run.getElementsByTagName('w:t');
      for (let k = 0; k < textNodes.length; k++) {
        runText += textNodes[k].textContent || '';
      }
      
      // Nếu run này có underline, lưu lại
      if (isUnderlined && runText.trim()) {
        hasUnderline = true;
        underlinedSegments.push(runText.trim());
      }
      
      text += runText;
    }
    
    // Normalize text
    text = normalizeVietnamese(text.trim());
    text = normalizeLatex(text);
    
    // CẢI TIẾN: Detect markdown underline format: [X]{.underline}
    const markdownUnderlinePattern = /\[([A-Da-d])\]\{\.underline\}/g;
    let mdMatch;
    while ((mdMatch = markdownUnderlinePattern.exec(text)) !== null) {
      hasUnderline = true;
      underlinedSegments.push(mdMatch[1]);
    }
    
    // Remove markdown underline syntax from text for cleaner display
    text = text.replace(/\[([A-Da-d])\]\{\.underline\}/g, '$1');
    
    if (text || imageRIds.length > 0) {
      paragraphs.push({ 
        text, 
        imageRIds, 
        hasUnderline, 
        underlinedSegments 
      });
    }
  }
  
  return paragraphs;
}

// ============================================================
// PARSE ALL QUESTIONS
// ============================================================

function parseAllQuestions(paragraphs: ParagraphData[], images: ImageData[]): ExamData {
  const examData: ExamData = {
    title: '',
    timeLimit: 90,
    sections: [],
    questions: [],
    answers: {},
    images: []
  };
  
  const fullText = paragraphs.map(p => p.text).join('\n');
  const sectionInfo = detectSections(fullText, paragraphs);
  console.log('📊 Section info:', sectionInfo);
  
  const part1Questions = parsePart1WithUnderline(paragraphs, sectionInfo.part1Start, sectionInfo.part2Start, images);
  const part2Questions = parsePart2(paragraphs, sectionInfo.part2Start, sectionInfo.part3Start, images);
  const part3Questions = parsePart3(paragraphs, sectionInfo.part3Start, paragraphs.length, images);
  
  console.log(`📊 Parsed: PHẦN 1=${part1Questions.length}, PHẦN 2=${part2Questions.length}, PHẦN 3=${part3Questions.length}`);
  
  let globalIndex = 0;
  
  // PHẦN 1
  if (part1Questions.length > 0) {
    const section1Questions: Question[] = [];
    for (const pq of part1Questions) {
      const q = convertToQuestion(pq, globalIndex++);
      section1Questions.push(q);
      examData.questions.push(q);
      if (q.correctAnswer) {
        examData.answers[q.number] = q.correctAnswer;
      }
    }
    
    examData.sections.push({
      name: 'PHẦN 1. Trắc nghiệm nhiều lựa chọn',
      description: 'Thí sinh chọn một phương án đúng A, B, C hoặc D',
      points: '',
      questions: section1Questions,
      sectionType: 'multiple_choice'
    });
  }
  
  // PHẦN 2
  if (part2Questions.length > 0) {
    const section2Questions: Question[] = [];
    for (const pq of part2Questions) {
      const q = convertToQuestion(pq, globalIndex++);
      section2Questions.push(q);
      examData.questions.push(q);
    }
    
    examData.sections.push({
      name: 'PHẦN 2. Trắc nghiệm đúng sai',
      description: 'Thí sinh chọn Đúng hoặc Sai cho mỗi ý a), b), c), d)',
      points: '',
      questions: section2Questions,
      sectionType: 'true_false'
    });
  }
  
  // PHẦN 3
  if (part3Questions.length > 0) {
    const section3Questions: Question[] = [];
    for (const pq of part3Questions) {
      const q = convertToQuestion(pq, globalIndex++);
      section3Questions.push(q);
      examData.questions.push(q);
      if (q.correctAnswer) {
        examData.answers[q.number] = q.correctAnswer;
      }
    }
    
    examData.sections.push({
      name: 'PHẦN 3. Trắc nghiệm trả lời ngắn',
      description: 'Thí sinh điền đáp án số vào ô trống',
      points: '',
      questions: section3Questions,
      sectionType: 'short_answer'
    });
  }
  
  return examData;
}

// ============================================================
// DETECT SECTIONS
// ============================================================

interface SectionInfo {
  part1Start: number;
  part2Start: number;
  part3Start: number;
}

function detectSections(fullText: string, paragraphs: ParagraphData[]): SectionInfo {
  const info: SectionInfo = {
    part1Start: -1,
    part2Start: -1,
    part3Start: -1
  };
  
  const part1Patterns = [
    /PHẦN\s*1/i,
    /PH[ẦAÀ]N\s*1/i,
    /PHẦN\s+I[.\s]/i,
    /Phần\s*1/i,
    /I\.\s*TR[ẮAĂ]C\s*NGHI[ỆEÊ]M/i
  ];
  
  const part2Patterns = [
    /PHẦN\s*2/i,
    /PH[ẦAÀ]N\s*2/i,
    /PHẦN\s+II[.\s]/i,
    /Phần\s*2/i,
    /II\.\s*[ĐD][ÚU]NG\s*SAI/i,
    /ĐÚNG\s*SAI/i
  ];
  
  const part3Patterns = [
    /PHẦN\s*3/i,
    /PH[ẦAÀ]N\s*3/i,
    /PHẦN\s+III[.\s]/i,
    /Phần\s*3/i,
    /III\.\s*TR[ẢAẢ]\s*L[ỜOỞ]I/i,
    /TRẢ\s*LỜI\s*NG[ẮAĂ]N/i
  ];
  
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i].text;
    
    if (info.part1Start === -1) {
      for (const pattern of part1Patterns) {
        if (pattern.test(text)) {
          info.part1Start = i;
          break;
        }
      }
    }
    
    if (info.part2Start === -1 && i > info.part1Start) {
      for (const pattern of part2Patterns) {
        if (pattern.test(text)) {
          info.part2Start = i;
          break;
        }
      }
    }
    
    if (info.part3Start === -1 && i > Math.max(info.part1Start, info.part2Start)) {
      for (const pattern of part3Patterns) {
        if (pattern.test(text)) {
          info.part3Start = i;
          break;
        }
      }
    }
  }
  
  if (info.part1Start === -1) {
    info.part1Start = 0;
  }
  
  if (info.part2Start === -1) {
    info.part2Start = paragraphs.length;
  }
  if (info.part3Start === -1) {
    info.part3Start = paragraphs.length;
  }
  
  return info;
}

// ============================================================
// CẢI TIẾN: PARSE PHẦN 1 VỚI UNDERLINE DETECTION
// ============================================================

function parsePart1WithUnderline(
  paragraphs: ParagraphData[], 
  startIdx: number, 
  endIdx: number,
  images: ImageData[]
): ParsedQuestion[] {
  if (startIdx < 0 || endIdx <= startIdx) return [];
  
  const questions: ParsedQuestion[] = [];
  let currentQ: ParsedQuestion | null = null;
  let collectingContent = false;
  let contentBuffer: string[] = [];
  let inSolution = false;
  
  // Lưu thông tin underline cho question hiện tại
  let currentQuestionUnderlinedLetters: string[] = [];
  
  const questionPattern = /^C[âaÂA][uU]\s*(\d+)\s*[.:]\s*(.*)/i;
  const optionPattern = /^([A-D])[.\)]\s*(.*)/i;
  const answerPattern = /Ch[oọ]n\s*([A-D])/i;
  
  for (let i = startIdx; i < endIdx; i++) {
    const para = paragraphs[i];
    const text = para.text;
    const imageRIds = para.imageRIds;
    
    if (!text && imageRIds.length === 0) continue;
    
    // Skip section headers
    if (/PHẦN\s*\d/i.test(text) || /Trắc\s*nghiệm/i.test(text)) {
      continue;
    }
    
    // Detect câu hỏi mới
    const qMatch = text.match(questionPattern);
    if (qMatch) {
      // Lưu câu hỏi trước đó
      if (currentQ) {
        if (contentBuffer.length > 0 && !currentQ.text) {
          currentQ.text = contentBuffer.join(' ').trim();
        }
        
        // CẢI TIẾN: Nếu chưa có correctAnswer, check underline
        if (!currentQ.correctAnswer && currentQuestionUnderlinedLetters.length > 0) {
          // Lấy letter đầu tiên được underline làm đáp án
          const underlinedAnswer = currentQuestionUnderlinedLetters.find(l => 
            /^[A-D]$/i.test(l)
          );
          if (underlinedAnswer) {
            currentQ.correctAnswer = underlinedAnswer.toUpperCase();
            console.log(`📝 Câu ${currentQ.number}: Đáp án từ underline = ${currentQ.correctAnswer}`);
          }
        }
        
        if (currentQ.text) {
          questions.push(currentQ);
        }
      }
      
      const qNum = parseInt(qMatch[1]);
      const restText = qMatch[2].trim();
      
      currentQ = {
        number: qNum,
        globalIndex: 0,
        part: 1,
        type: 'multiple_choice',
        text: '',
        options: [],
        correctAnswer: null,
        solution: '',
        images: []
      };
      
      collectingContent = true;
      inSolution = false;
      contentBuffer = restText ? [restText] : [];
      currentQuestionUnderlinedLetters = [];
      
      // Check underline trong dòng câu hỏi
      if (para.hasUnderline) {
        currentQuestionUnderlinedLetters.push(...para.underlinedSegments);
      }
      
      if (imageRIds.length > 0) {
        attachImages(currentQ, imageRIds, images);
      }
      
      continue;
    }
    
    if (!currentQ) continue;
    
    // Detect "Lời giải"
    if (/^L[ờơ]i\s*gi[ảa]i/i.test(text)) {
      if (contentBuffer.length > 0 && !currentQ.text) {
        currentQ.text = contentBuffer.join(' ').trim();
        contentBuffer = [];
      }
      collectingContent = false;
      inSolution = true;
      continue;
    }
    
    // Detect "Chọn X" 
    const chonMatch = text.match(answerPattern);
    if (chonMatch) {
      currentQ.correctAnswer = chonMatch[1].toUpperCase();
      continue;
    }
    
    // Detect options: A. B. C. D.
    const optMatch = text.match(optionPattern);
    if (optMatch && collectingContent) {
      if (currentQ.options.length === 0 && contentBuffer.length > 0) {
        currentQ.text = contentBuffer.join(' ').trim();
        contentBuffer = [];
      }
      
      const letter = optMatch[1].toUpperCase();
      
      currentQ.options.push({
        letter: letter,
        text: optMatch[2].trim()
      });
      
      // CẢI TIẾN: Check nếu option này có underline
      if (para.hasUnderline) {
        // Check nếu letter option được underline
        const hasUnderlinedLetter = para.underlinedSegments.some(seg => 
          seg.toUpperCase() === letter || 
          seg.includes(letter)
        );
        if (hasUnderlinedLetter) {
          currentQuestionUnderlinedLetters.push(letter);
          console.log(`🔍 Phát hiện option ${letter} có underline ở câu ${currentQ.number}`);
        }
      }
      
      continue;
    }
    
    // Collect content
    if (collectingContent && text && !inSolution) {
      if (/^H[ìi]nh\s*\d+/i.test(text)) {
        if (imageRIds.length > 0) {
          attachImages(currentQ, imageRIds, images);
        }
        continue;
      }
      contentBuffer.push(text);
      
      // Check underline trong content
      if (para.hasUnderline) {
        currentQuestionUnderlinedLetters.push(...para.underlinedSegments);
      }
    }
    
    if (imageRIds.length > 0 && currentQ && !inSolution) {
      attachImages(currentQ, imageRIds, images);
    }
  }
  
  // Lưu câu cuối
  if (currentQ) {
    if (contentBuffer.length > 0 && !currentQ.text) {
      currentQ.text = contentBuffer.join(' ').trim();
    }
    
    // CẢI TIẾN: Check underline cho câu cuối
    if (!currentQ.correctAnswer && currentQuestionUnderlinedLetters.length > 0) {
      const underlinedAnswer = currentQuestionUnderlinedLetters.find(l => 
        /^[A-D]$/i.test(l)
      );
      if (underlinedAnswer) {
        currentQ.correctAnswer = underlinedAnswer.toUpperCase();
        console.log(`📝 Câu ${currentQ.number}: Đáp án từ underline = ${currentQ.correctAnswer}`);
      }
    }
    
    if (currentQ.text) {
      questions.push(currentQ);
    }
  }
  
  questions.sort((a, b) => a.number - b.number);
  
  return questions;
}

// ============================================================
// PARSE PHẦN 2: ĐÚNG SAI (giữ nguyên)
// ============================================================

function parsePart2(
  paragraphs: ParagraphData[], 
  startIdx: number, 
  endIdx: number,
  images: ImageData[]
): ParsedQuestion[] {
  if (startIdx < 0 || endIdx <= startIdx || startIdx >= paragraphs.length) return [];
  
  const questions: ParsedQuestion[] = [];
  let currentQ: ParsedQuestion | null = null;
  let collectingContent = false;
  let contentBuffer: string[] = [];
  let inSolution = false;
  
  const questionPattern = /^C[âaÂA][uU]\s*(\d+)\s*[.:]\s*(.*)/i;
  const statementPattern = /^([a-d])\)\s*(.*)/i;
  
  for (let i = startIdx; i < endIdx; i++) {
    const text = paragraphs[i].text;
    const imageRIds = paragraphs[i].imageRIds;
    
    if (!text && imageRIds.length === 0) continue;
    
    if (/PHẦN\s*\d/i.test(text)) continue;
    
    const qMatch = text.match(questionPattern);
    if (qMatch) {
      if (currentQ) {
        if (contentBuffer.length > 0 && !currentQ.text) {
          currentQ.text = contentBuffer.join(' ').trim();
        }
        if (currentQ.text) {
          questions.push(currentQ);
        }
      }
      
      const qNum = parseInt(qMatch[1]);
      const restText = qMatch[2].trim();
      
      currentQ = {
        number: qNum,
        globalIndex: 0,
        part: 2,
        type: 'true_false',
        text: '',
        options: [],
        correctAnswer: null,
        solution: '',
        images: []
      };
      
      collectingContent = true;
      inSolution = false;
      contentBuffer = restText ? [restText] : [];
      
      if (imageRIds.length > 0) {
        attachImages(currentQ, imageRIds, images);
      }
      
      continue;
    }
    
    if (!currentQ) continue;
    
    if (/^L[ờơ]i\s*gi[ảa]i/i.test(text)) {
      if (contentBuffer.length > 0 && !currentQ.text) {
        currentQ.text = contentBuffer.join(' ').trim();
        contentBuffer = [];
      }
      collectingContent = false;
      inSolution = true;
      continue;
    }
    
    const stmtMatch = text.match(statementPattern);
    if (stmtMatch && collectingContent) {
      if (currentQ.options.length === 0 && contentBuffer.length > 0) {
        currentQ.text = contentBuffer.join(' ').trim();
        contentBuffer = [];
      }
      
      currentQ.options.push({
        letter: stmtMatch[1].toLowerCase(),
        text: stmtMatch[2].trim()
      });
      continue;
    }
    
    if (collectingContent && text && !inSolution) {
      if (/^H[ìi]nh\s*\d+/i.test(text)) {
        if (imageRIds.length > 0) {
          attachImages(currentQ, imageRIds, images);
        }
        continue;
      }
      contentBuffer.push(text);
    }
    
    if (imageRIds.length > 0 && currentQ && !inSolution) {
      attachImages(currentQ, imageRIds, images);
    }
  }
  
  if (currentQ) {
    if (contentBuffer.length > 0 && !currentQ.text) {
      currentQ.text = contentBuffer.join(' ').trim();
    }
    if (currentQ.text) {
      questions.push(currentQ);
    }
  }
  
  questions.sort((a, b) => a.number - b.number);
  
  return questions;
}

// ============================================================
// PARSE PHẦN 3: TRẢ LỜI NGẮN (giữ nguyên)
// ============================================================

function parsePart3(
  paragraphs: ParagraphData[], 
  startIdx: number, 
  endIdx: number,
  images: ImageData[]
): ParsedQuestion[] {
  if (startIdx < 0 || startIdx >= paragraphs.length) return [];
  
  const questions: ParsedQuestion[] = [];
  let currentQ: ParsedQuestion | null = null;
  let collectingContent = false;
  let contentBuffer: string[] = [];
  
  const questionPattern = /^C[âaÂA][uU]\s*(\d+)\s*[.:]\s*(.*)/i;
  const answerPattern = /^[*\s]*[ĐD][áa]p\s*[áa]n[:\s]*(.+)/i;
  
  for (let i = startIdx; i < endIdx; i++) {
    const text = paragraphs[i].text;
    const imageRIds = paragraphs[i].imageRIds;
    
    if (!text && imageRIds.length === 0) continue;
    
    if (/PHẦN\s*\d/i.test(text)) continue;
    
    const qMatch = text.match(questionPattern);
    if (qMatch) {
      if (currentQ) {
        if (contentBuffer.length > 0) {
          currentQ.text = contentBuffer.join(' ').trim();
        }
        if (currentQ.text) {
          questions.push(currentQ);
        }
      }
      
      const qNum = parseInt(qMatch[1]);
      const restText = qMatch[2].trim();
      
      currentQ = {
        number: qNum,
        globalIndex: 0,
        part: 3,
        type: 'short_answer',
        text: '',
        options: [],
        correctAnswer: null,
        solution: '',
        images: []
      };
      
      collectingContent = true;
      contentBuffer = restText ? [restText] : [];
      
      if (imageRIds.length > 0) {
        attachImages(currentQ, imageRIds, images);
      }
      
      continue;
    }
    
    if (!currentQ) continue;
    
    if (/^L[ờơ]i\s*gi[ảa]i/i.test(text)) {
      if (contentBuffer.length > 0) {
        currentQ.text = contentBuffer.join(' ').trim();
        contentBuffer = [];
      }
      collectingContent = false;
      continue;
    }
    
    const ansMatch = text.match(answerPattern);
    if (ansMatch) {
      currentQ.correctAnswer = ansMatch[1].trim();
      continue;
    }
    
    if (collectingContent && text) {
      if (/^H[ìi]nh\s*\d+/i.test(text)) {
        if (imageRIds.length > 0) {
          attachImages(currentQ, imageRIds, images);
        }
        continue;
      }
      contentBuffer.push(text);
    }
    
    if (imageRIds.length > 0 && currentQ) {
      attachImages(currentQ, imageRIds, images);
    }
  }
  
  if (currentQ) {
    if (contentBuffer.length > 0) {
      currentQ.text = contentBuffer.join(' ').trim();
    }
    if (currentQ.text) {
      questions.push(currentQ);
    }
  }
  
  questions.sort((a, b) => a.number - b.number);
  
  return questions;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function attachImages(q: ParsedQuestion, rIds: string[], images: ImageData[]): void {
  for (const rId of rIds) {
    let img = images.find(i => i.rId === rId);
    
    if (!img) {
      for (const image of images) {
        if (image.filename && rId.includes(image.filename)) {
          img = image;
          break;
        }
      }
    }
    
    if (img && !q.images.find(i => i.id === img!.id)) {
      q.images.push(img);
    }
  }
}

function convertToQuestion(pq: ParsedQuestion, globalIndex: number): Question {
  const uniqueNumber = pq.part * 100 + pq.number;
  
  return {
    number: uniqueNumber,
    text: escapeHtmlPreserveLaTeX(pq.text),
    type: pq.type,
    options: pq.options.map(opt => ({
      ...opt,
      text: escapeHtmlPreserveLaTeX(opt.text)
    })),
    correctAnswer: pq.correctAnswer,
    part: `PHẦN ${pq.part}`,
    images: pq.images,
    solution: pq.solution,
    section: {
      letter: String(pq.part),
      name: getPartName(pq.part),
      points: ''
    }
  };
}

function getPartName(part: number): string {
  switch (part) {
    case 1: return 'Trắc nghiệm nhiều lựa chọn';
    case 2: return 'Trắc nghiệm đúng sai';
    case 3: return 'Trắc nghiệm trả lời ngắn';
    default: return '';
  }
}

// ============================================================
// VALIDATE
// ============================================================

export const validateExamData = (data: ExamData): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!data.questions || data.questions.length === 0) {
    errors.push('Không tìm thấy câu hỏi nào trong file');
  }
  
  let part1 = 0, part2 = 0, part3 = 0;
  let withAnswer = 0, withoutAnswer = 0;
  
  data.questions.forEach((q: Question) => {
    if (!q.text || !q.text.trim()) {
      errors.push(`Câu ${q.number}: Thiếu nội dung câu hỏi`);
    }
    
    const part = Math.floor(q.number / 100);
    if (part === 1) part1++;
    else if (part === 2) part2++;
    else if (part === 3) part3++;
    
    if (q.correctAnswer) {
      withAnswer++;
    } else {
      withoutAnswer++;
    }
  });
  
  console.log(`📊 Question count: PHẦN 1=${part1}, PHẦN 2=${part2}, PHẦN 3=${part3}`);
  console.log(`📊 Answers: Có đáp án=${withAnswer}, Chưa có=${withoutAnswer}`);
  
  return {
    valid: errors.length === 0,
    errors
  };
};

// ============================================================
// UTILITIES
// ============================================================

export function isWebCompatibleImage(contentType: string): boolean {
  const webTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
  return webTypes.includes(contentType);
}

export function getImageDataUrl(img: { base64: string; contentType: string }): string {
  if (!img.base64) return '';
  return `data:${img.contentType};base64,${img.base64}`;
}
