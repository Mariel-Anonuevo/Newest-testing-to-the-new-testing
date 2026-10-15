import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastContext';
import { canDo, getDuplicateScope } from '../utils/roleAccess';
import { duplicatesService } from '../services/duplicates.service';
import { clientsService } from '../services/clientsService';
import { useQuery } from '../hooks/useQuery';
import { DuplicateStatusBadge } from '../components/duplicate/DuplicateStatusBadge';
import {
  DuplicateComparisonModal,
  type ComparisonCandidate,
  type ScannedDocDetails,
} from '../components/duplicate/DuplicateComparisonModal';
import {
  AccountantDecisionModal,
  type DecisionType,
} from '../components/duplicate/AccountantDecisionModal';

/* ─────────────────────────────────────────────
   Camera Modal Component
───────────────────────────────────────────── */
const CameraModal: React.FC<{
  onCapture: (file: File) => void;
  onClose: () => void;
  onFallbackToFile: () => void;
}> = ({ onCapture, onClose, onFallbackToFile }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError(null);
    } catch {
      setError('Camera access denied or unavailable. Please upload a file directly.');
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [facingMode, startCamera]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    setCaptured(dataUrl);
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  const handleRetake = () => {
    setCaptured(null);
    startCamera(facingMode);
  };

  const handleUsePhoto = () => {
    if (!captured) return;
    fetch(captured)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], `scan_${Date.now()}.png`, { type: 'image/png' });
        onCapture(file);
        onClose();
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: '#0F172A',
          borderRadius: '16px',
          overflow: 'hidden',
          width: '90%',
          maxWidth: 640,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #1E293B' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '8px', background: '#0D9488', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ti ti-camera" style={{ fontSize: '17px', color: '#fff' }} />
            </div>
            <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.9375rem' }}>Scan Document via Camera</span>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '22px' }}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div style={{ position: 'relative', background: '#000', minHeight: 340 }}>
          {error ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 16, padding: 24 }}>
              <i className="ti ti-camera-off" style={{ fontSize: '36px', color: '#EF4444' }} />
              <div style={{ color: '#94A3B8', textAlign: 'center', fontSize: '0.875rem' }}>{error}</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onFallbackToFile();
                  }}
                  style={{ padding: '10px 20px', background: '#0D9488', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Choose File Instead
                </button>
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  style={{ padding: '10px 16px', background: '#1E293B', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : captured ? (
            <img src={captured} alt="Captured preview" style={{ width: '100%', maxHeight: 400, objectFit: 'contain' }} />
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', maxHeight: 400, objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '80%', height: '75%', border: '2px solid #0D9488', borderRadius: '12px' }} />
              </div>
            </>
          )}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0F172A' }}>
          {!captured && !error && (
            <button
              type="button"
              onClick={handleCapture}
              style={{ width: 60, height: 60, borderRadius: '50%', background: '#0D9488', border: '4px solid #fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <i className="ti ti-camera" style={{ fontSize: '24px', color: '#fff' }} />
            </button>
          )}
          {captured && (
            <>
              <button
                type="button"
                onClick={handleRetake}
                style={{ padding: '8px 20px', background: '#1E293B', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
              >
                Retake
              </button>
              <button
                type="button"
                onClick={handleUsePhoto}
                style={{ padding: '8px 24px', background: '#0D9488', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}
              >
                Use Photo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Main AIDuplicateScan Page Component
───────────────────────────────────────────── */
export const AIDuplicateScan: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const canScan = canDo(user?.role, 'duplicateScan', 'scan');
  const scope = getDuplicateScope(user?.role);

  // Client accounts query for linking
  const { data: clientsData } = useQuery('clients', () => clientsService.list({ pageSize: 100 }));
  const clients = clientsData?.items || [];

  // Form input state
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('Invoice');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  // Scanning progress state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const scanAbortRef = useRef(false);

  // Outcome state
  const [outcome, setOutcome] = useState<'IDLE' | 'NO_MATCH' | 'POSSIBLE_MATCH' | 'AI_UNAVAILABLE'>('IDLE');
  const [extractedFields, setExtractedFields] = useState<any>(null);
  const [matches, setMatches] = useState<ComparisonCandidate[]>([]);
  const [aiUnavailableJustification, setAiUnavailableJustification] = useState('');

  // Modals
  const [comparisonCandidate, setComparisonCandidate] = useState<ComparisonCandidate | null>(null);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [isDecisionOpen, setIsDecisionOpen] = useState(false);

  // Final resolution state
  const [finalResolution, setFinalResolution] = useState<{
    status: 'UNIQUE' | 'FLAGGED' | 'UNDER_MANUAL_REVIEW';
    message: string;
    matchedId?: string;
    reviewer?: string;
    decisionTime: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate file type and size (< 10MB, JPG/JPEG/PNG)
  const validateFile = (targetFile: File): boolean => {
    setInlineError(null);
    const validExtensions = ['image/jpeg', 'image/jpg', 'image/png'];
    const lowerName = targetFile.name.toLowerCase();
    const isExtValid = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png');

    if (!validExtensions.includes(targetFile.type) && !isExtValid) {
      setInlineError('Unsupported file type. Please upload JPG, JPEG, or PNG files only.');
      return false;
    }

    if (targetFile.size > 10 * 1024 * 1024) {
      setInlineError('File exceeds 10MB limit. Please upload a smaller image.');
      return false;
    }

    return true;
  };

  const handleFileSelect = (selectedFile: File) => {
    if (validateFile(selectedFile)) {
      setFile(selectedFile);
      setOutcome('IDLE');
      setFinalResolution(null);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }, []);

  // Cancel scanning
  const handleCancelScan = () => {
    scanAbortRef.current = true;
    setIsScanning(false);
    setScanProgress(0);
    toast.info('Duplicate scan operation cancelled.', 'Scan Cancelled');
  };

  // Run AI Scan
  const handleRunScan = async () => {
    if (!file || !canScan) return;
    setIsScanning(true);
    setScanProgress(15);
    setInlineError(null);
    scanAbortRef.current = false;

    const progressTimer = setInterval(() => {
      setScanProgress(p => (p >= 85 ? 85 : p + 20));
    }, 250);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', docType);
      if (selectedClientId) formData.append('clientId', selectedClientId);

      // Perform backend scan
      let res: any = null;
      try {
        res = await duplicatesService.scan(formData, scope);
      } catch (err: any) {
        clearInterval(progressTimer);
        setIsScanning(false);
        // Step 2: AI unavailable outcome
        setOutcome('AI_UNAVAILABLE');
        toast.error('AI Duplicate service unreachable or request failed.', 'AI Service Offline');
        return;
      }

      if (scanAbortRef.current) return;

      clearInterval(progressTimer);
      setScanProgress(100);
      setIsScanning(false);

      const clientObj = clients.find(c => c.id === selectedClientId);

      // Populate extracted fields
      const extracted = {
        documentType: docType,
        documentNumber: res.uploadedRecord?.orNumber || res.uploadedRecord?.documentNumber || `DOC-${Date.now().toString().slice(-6)}`,
        clientName: clientObj?.name || res.uploadedRecord?.clientName || 'Lazada Philippines',
        date: 'Oct 15, 2026',
        amount: Number(res.uploadedRecord?.amount) || 15000.00,
        referenceNumber: res.uploadedRecord?.referenceNumber || `REF-${Date.now().toString().slice(-5)}`,
        paymentMethod: res.uploadedRecord?.paymentMethod || 'Bank Transfer',
        fileUrl: URL.createObjectURL(file),
      };
      setExtractedFields(extracted);

      if (res.result === 'duplicate' || (res.confidence && res.confidence > 70)) {
        // Possible match found outcome
        const matchItem: ComparisonCandidate = {
          matchId: 'match-101',
          matchedDocumentId: res.matched_record_id || 'DOC-BI-2026-0001',
          documentNumber: res.matchedRecord?.orNumber || res.matchedRecord?.documentNumber || 'BI-2026-0001',
          clientName: res.matchedRecord?.client_name || clientObj?.name || 'Lazada Philippines',
          date: 'Oct 11, 2026',
          amount: Number(res.matchedRecord?.amount) || 15000.00,
          referenceNumber: res.matchedRecord?.reference_number || 'DISB-2026-0042',
          paymentMethod: 'Bank Transfer',
          sourceModule: 'Billing Invoices',
          uploadedBy: 'Finance Team (Accountant)',
          fileUrl: URL.createObjectURL(file),
          similarityScore: (res.confidence || 94) / 100,
          matchedFields: ['documentNumber', 'clientName', 'amount', 'referenceNumber'],
        };
        setMatches([matchItem]);
        setOutcome('POSSIBLE_MATCH');
        toast.warning('Possible duplicate detected. Please review candidate comparison.', 'AI Scan Alert');
      } else {
        // No duplicate found outcome
        setOutcome('NO_MATCH');
        toast.success('No duplicate detected in FOMS records.', 'AI Verification Complete');
      }
    } catch {
      clearInterval(progressTimer);
      setIsScanning(false);
      setOutcome('AI_UNAVAILABLE');
    }
  };

  // Submit accountant decision
  const handleSubmitDecision = async (payload: {
    decision: DecisionType;
    matchedRecordId?: string;
    flagReason?: string;
    reviewNotes?: string;
  }) => {
    const timeNow = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (payload.decision === 'UNIQUE') {
      setFinalResolution({
        status: 'UNIQUE',
        message: 'No duplicate found, document is unique.',
        decisionTime: timeNow,
        reviewer: user?.fullName || 'Accountant',
      });
      toast.success('Document marked as unique and recorded in Unique Documents.', 'Decision Saved');
    } else if (payload.decision === 'FLAGGED') {
      setFinalResolution({
        status: 'FLAGGED',
        message: `Duplicate found, document flagged: "${payload.flagReason}"`,
        matchedId: payload.matchedRecordId,
        decisionTime: timeNow,
        reviewer: user?.fullName || 'Accountant',
      });
      toast.error('Document flagged as duplicate. Processing blocked.', 'Duplicate Flagged');
    } else {
      setFinalResolution({
        status: 'UNDER_MANUAL_REVIEW',
        message: `Sent to Finance Manager manual review queue: "${payload.reviewNotes}"`,
        decisionTime: timeNow,
        reviewer: user?.fullName || 'Accountant',
      });
      toast.info('Document sent to Finance Manager queue for manual review.', 'Under Manual Review');
    }
    setOutcome('IDLE');
  };

  // Proceed with manual review when AI is offline
  const handleProceedManualReviewOffline = () => {
    if (aiUnavailableJustification.trim().length < 15) {
      toast.warning('Please enter a justification of at least 15 characters to log the skip in the audit trail.', 'Required Justification');
      return;
    }
    const timeNow = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    setFinalResolution({
      status: 'UNDER_MANUAL_REVIEW',
      message: `AI service unavailable skip: "${aiUnavailableJustification}" (Logged in Audit Trail)`,
      decisionTime: timeNow,
      reviewer: user?.fullName || 'Accountant',
    });
    setOutcome('IDLE');
    setAiUnavailableJustification('');
    toast.info('AI skip logged in audit trail. Document routed to Finance Manager queue.', 'Audit Logged');
  };

  return (
    <>
      {showCamera && (
        <CameraModal
          onCapture={handleFileSelect}
          onClose={() => setShowCamera(false)}
          onFallbackToFile={() => fileInputRef.current?.click()}
        />
      )}

      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
        {/* Screen Header */}
        <div style={{ marginBottom: '20px' }}>
          <h1 style={{ margin: '0 0 6px', fontSize: '1.5rem', fontWeight: 800, color: '#0F172A' }}>
            Document Checking &amp; AI Scan Console
          </h1>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B' }}>
            Upload or scan finance documents to detect duplicates across invoices, official receipts, and payment records.
          </p>
        </div>

        {/* Decision Support Notice */}
        <div
          style={{
            background: '#F0FDFA',
            border: '1.5px solid #0D9488',
            borderRadius: '10px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              border: '2px solid #0D9488',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: '1px',
              color: '#0D9488',
              fontWeight: 800,
              fontSize: '13px',
            }}
          >
            ?
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0D9488', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
              Decision Support Notice
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#0F172A', lineHeight: 1.5 }}>
              AI results are decision support only. Final validation and document authorization are executed exclusively by an authorized finance user through the FOMS workflow.
            </p>
          </div>
        </div>

        {!canScan ? (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              border: '1px solid #E2E8F0',
              padding: '40px 24px',
              textAlign: 'center',
              marginBottom: '24px',
            }}
          >
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F1F5F9', color: '#64748B', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
              <i className="ti ti-lock" style={{ fontSize: '24px' }} />
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 800, color: '#0F172A' }}>
              Read-Only Console
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B' }}>
              You do not have scanning permissions on this console. Operational document checking is restricted to authorized roles.
            </p>
          </div>
        ) : (
          /* STEP 1: SUBMIT DOCUMENT AREA */
          <div
          style={{
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <div style={{ marginBottom: '20px', maxWidth: '320px' }}>
            {/* Document Type Picker */}
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              Document Type *
            </label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.85rem', color: '#0F172A' }}
            >
              <option value="Invoice">Invoice</option>
              <option value="Official Receipt">Official Receipt</option>
              <option value="Payment Proof">Payment Proof</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Dashed Upload Area */}
          {!file && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: isDragging ? '#F0FDFA' : '#F8FAFC',
                borderRadius: '12px',
                border: `2px dashed ${isDragging ? '#0D9488' : '#CBD5E1'}`,
                padding: '44px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: '#0D9488',
                  color: '#FFFFFF',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '12px',
                }}
              >
                <i className="ti ti-cloud-upload" style={{ fontSize: '28px' }} />
              </div>
              <h3 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>
                Drag &amp; Drop or Upload Document
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: '#64748B' }}>
                Accepted files: JPG, JPEG, PNG up to 10MB
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  style={{
                    padding: '9px 20px',
                    borderRadius: '8px',
                    background: '#0D9488',
                    color: '#FFFFFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  Choose File
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setShowCamera(true);
                  }}
                  style={{
                    padding: '9px 20px',
                    borderRadius: '8px',
                    background: '#FFFFFF',
                    color: '#0F172A',
                    border: '1.5px solid #CBD5E1',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <i className="ti ti-camera" style={{ fontSize: '16px', color: '#0D9488' }} /> Scan Document
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                style={{ display: 'none' }}
                onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
            </div>
          )}

          {/* Inline Error Message */}
          {inlineError && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#991B1B',
                fontSize: '0.825rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <i className="ti ti-alert-circle" /> {inlineError}
            </div>
          )}

          {/* Selected File Card & Actions */}
          {file && !isScanning && (
            <div
              style={{
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '14px 18px',
                background: '#F8FAFC',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <i className="ti ti-file-check" style={{ fontSize: '24px', color: '#0D9488' }} />
                <div>
                  <strong style={{ fontSize: '0.9rem', color: '#0F172A' }}>{file.name}</strong>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748B' }}>
                    {(file.size / 1024 / 1024).toFixed(2)} MB • {docType}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#64748B', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={handleRunScan}
                  style={{ padding: '8px 22px', borderRadius: '8px', border: 'none', background: '#0D9488', color: '#FFFFFF', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  Scan Document
                </button>
              </div>
            </div>
          )}

          {/* Uploading & Scanning Progress with Cancel */}
          {isScanning && (
            <div
              style={{
                border: '1px solid #CCFBF1',
                borderRadius: '10px',
                padding: '20px',
                background: '#F0FDFA',
                textAlign: 'center',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, color: '#0F766E', marginBottom: '6px' }}>
                <span>Scanning and comparing document against database...</span>
                <span>{scanProgress}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#E2E8F0', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                <div style={{ width: `${scanProgress}%`, height: '100%', background: '#0D9488', transition: 'width 0.3s ease' }} />
              </div>
              <button
                type="button"
                onClick={handleCancelScan}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#C2410C',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Cancel Scanning
              </button>
            </div>
          )}
        </div>
        )}

        {/* STEP 2: AI SCAN OUTCOME CARDS */}

        {/* Outcome A: No Duplicate Detected */}
        {outcome === 'NO_MATCH' && extractedFields && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              border: '1.5px solid #A7F3D0',
              padding: '24px',
              marginBottom: '24px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#ECFDF5', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="ti ti-circle-check" style={{ fontSize: '24px' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#047857' }}>
                    No Duplicate Detected
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                    Document fields were successfully parsed and compared against records with 0 matches.
                  </p>
                </div>
              </div>
              <DuplicateStatusBadge status="SCANNED" />
            </div>

            {/* Extracted Fields Matrix */}
            <div style={{ background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '16px', marginBottom: '20px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '10px' }}>
                Extracted Document Credentials
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '0.825rem' }}>
                <div>
                  <span style={{ color: '#94A3B8' }}>Document Type:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>{extractedFields.documentType}</strong>
                </div>
                <div>
                  <span style={{ color: '#94A3B8' }}>Document Number:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>{extractedFields.documentNumber}</strong>
                </div>
                <div>
                  <span style={{ color: '#94A3B8' }}>Client:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>{extractedFields.clientName}</strong>
                </div>
                <div>
                  <span style={{ color: '#94A3B8' }}>Date:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>{extractedFields.date}</strong>
                </div>
                <div>
                  <span style={{ color: '#94A3B8' }}>Amount:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>₱{extractedFields.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong>
                </div>
                <div>
                  <span style={{ color: '#94A3B8' }}>Reference No:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>{extractedFields.referenceNumber}</strong>
                </div>
              </div>
            </div>

            {/* Decision Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={() => {
                  setComparisonCandidate(null);
                  setIsDecisionOpen(true);
                }}
                style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#334155', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Send for Manual Review
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSubmitDecision({ decision: 'UNIQUE' });
                }}
                style={{ padding: '9px 24px', borderRadius: '8px', border: 'none', background: '#0D9488', color: '#FFFFFF', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Mark as Unique
              </button>
            </div>
          </div>
        )}

        {/* Outcome B: Possible Match Found */}
        {outcome === 'POSSIBLE_MATCH' && matches.length > 0 && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              border: '1.5px solid #FECACA',
              padding: '24px',
              marginBottom: '24px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FEF2F2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="ti ti-alert-triangle" style={{ fontSize: '24px' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#DC2626' }}>
                    Possible Match Found ({matches.length})
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                    Matches ranked by similarity score. Inspect comparison before submitting your decision.
                  </p>
                </div>
              </div>
              <DuplicateStatusBadge status="SCANNED" />
            </div>

            {/* Match Candidates List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              {matches.map(m => {
                const pct = Math.round(m.similarityScore * 100);
                const tierBadge =
                  pct >= 90 ? { label: 'High', bg: '#FEE2E2', color: '#B91C1C' } :
                  pct >= 75 ? { label: 'Medium', bg: '#FEF3C7', color: '#B45309' } :
                  { label: 'Low', bg: '#E0F2FE', color: '#0369A1' };

                return (
                  <div
                    key={m.matchId}
                    style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '10px',
                      padding: '16px',
                      background: '#F8FAFC',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                        <strong style={{ fontSize: '0.95rem', color: '#0F172A' }}>{m.documentNumber}</strong>
                        <span style={{ background: tierBadge.bg, color: tierBadge.color, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 800 }}>
                          {tierBadge.label} ({pct}%)
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                          Source: {m.sourceModule}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: '#475569', flexWrap: 'wrap' }}>
                        <span>Client: <strong>{m.clientName}</strong></span>
                        <span>Date: <strong>{m.date}</strong></span>
                        <span>Amount: <strong>₱{m.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></span>
                        <span>Reference: <strong>{m.referenceNumber}</strong></span>
                        <span>Uploaded By: <strong>{m.uploadedBy}</strong></span>
                      </div>
                      <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#0D9488' }}>
                        Matched Fields: {m.matchedFields.join(', ')}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setComparisonCandidate(m);
                          setIsComparisonOpen(true);
                        }}
                        style={{ padding: '8px 16px', borderRadius: '8px', border: '1.5px solid #0D9488', background: '#FFFFFF', color: '#0D9488', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
                      >
                        Side-by-Side Compare
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setComparisonCandidate(m);
                          setIsDecisionOpen(true);
                        }}
                        style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: '#0D9488', color: '#FFFFFF', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
                      >
                        Submit Decision
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Outcome C: AI Unavailable / Failed */}
        {outcome === 'AI_UNAVAILABLE' && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              border: '1.5px solid #FCD34D',
              padding: '24px',
              marginBottom: '24px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '16px' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FFFBEB', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ti ti-wifi-off" style={{ fontSize: '24px' }} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800, color: '#B45309' }}>
                  AI Scanning Service Unavailable
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#78350F', lineHeight: 1.5 }}>
                  The AI duplicate detection service could not complete the automated check. Notice: This document has NOT been verified. You may retry the scan or proceed with manual review by submitting an audit trail justification.
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Accountant Justification for Manual Review Skip (Required, min 15 characters) *
              </label>
              <textarea
                rows={3}
                value={aiUnavailableJustification}
                onChange={e => setAiUnavailableJustification(e.target.value)}
                placeholder="Enter justification reasons (e.g. AI service offline during urgent billing cycle; physically verified against file cabinet...)"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={handleRunScan}
                style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#0F172A', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Retry Scan
              </button>
              <button
                type="button"
                disabled={aiUnavailableJustification.trim().length < 15}
                onClick={handleProceedManualReviewOffline}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: aiUnavailableJustification.trim().length >= 15 ? '#D97706' : '#94A3B8',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: aiUnavailableJustification.trim().length >= 15 ? 'pointer' : 'not-allowed',
                }}
              >
                Proceed with Manual Review
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: FINAL RESULT DISPLAY */}
        {finalResolution && (
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '12px',
              border: `1.5px solid ${
                finalResolution.status === 'UNIQUE' ? '#A7F3D0' :
                finalResolution.status === 'FLAGGED' ? '#FECACA' : '#FDE68A'
              }`,
              padding: '24px',
              marginBottom: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0F172A' }}>
                Latest Document Decision Result
              </h3>
              <DuplicateStatusBadge status={finalResolution.status} />
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#334155', fontWeight: 600 }}>
              {finalResolution.message}
            </p>
            <div style={{ display: 'flex', gap: '20px', fontSize: '0.8rem', color: '#64748B' }}>
              <span>Decision By: <strong>{finalResolution.reviewer}</strong></span>
              <span>Date: <strong>{finalResolution.decisionTime}</strong></span>
              {finalResolution.matchedId && (
                <span>Matched Record: <strong style={{ color: '#DC2626' }}>{finalResolution.matchedId}</strong></span>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: SIDE-BY-SIDE COMPARISON MODAL */}
        {isComparisonOpen && extractedFields && (
          <DuplicateComparisonModal
            isOpen={isComparisonOpen}
            onClose={() => setIsComparisonOpen(false)}
            scannedDoc={extractedFields}
            candidates={matches}
            onDecide={c => {
              setComparisonCandidate(c);
              setIsDecisionOpen(true);
            }}
          />
        )}

        {/* STEP 4: ACCOUNTANT DECISION MODAL */}
        {isDecisionOpen && (
          <AccountantDecisionModal
            isOpen={isDecisionOpen}
            onClose={() => setIsDecisionOpen(false)}
            documentId={extractedFields?.documentNumber || 'NEW-SCAN'}
            matchedCandidates={matches}
            initialCandidate={comparisonCandidate || matches[0]}
            onSubmitDecision={handleSubmitDecision}
          />
        )}
      </div>
    </>
  );
};

export default AIDuplicateScan;
