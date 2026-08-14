import React, { useRef, useState, useEffect } from 'react';
import logger from '../utils/logger';
import { X, RotateCcw, Check } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { getTerminology } from '../utils/terminology';
import { useFeedback } from '../context/FeedbackContext';

interface SignaturePadProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (signatureData: string, customerName: string) => void;
  title?: string;
  initialCustomerName?: string;
}

export function SignaturePad({ isOpen, onClose, onSave, title = "Unterschrift", initialCustomerName = "" }: SignaturePadProps) {
  const { notify } = useFeedback();
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const customerNameInputRef = useRef<HTMLInputElement>(null);
  const hasSignatureRef = useRef(false);
  const isDrawingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen) setCustomerName(initialCustomerName);
  }, [initialCustomerName, isOpen]);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return undefined;

    const canvas = canvasRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let initialized = false;

    const resizeCanvas = (preserveContent: boolean) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      const snapshot = document.createElement('canvas');
      if (preserveContent && hasSignatureRef.current && canvas.width > 0 && canvas.height > 0) {
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
      }

      // Höchstens zweifache Auflösung hält die PNG-Datei klein genug für den
      // API-Endpunkt, bleibt auf Retina-Displays aber deutlich schärfer.
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * pixelRatio);
      canvas.height = Math.round(rect.height * pixelRatio);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, rect.width, rect.height);
      if (snapshot.width > 0) {
        ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, rect.width, rect.height);
      }
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.imageSmoothingEnabled = true;
    };

    hasSignatureRef.current = false;
    setHasSignature(false);
    isDrawingRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      resizeCanvas(false);
      initialized = true;
      customerNameInputRef.current?.focus();
    });

    const resizeObserver = new ResizeObserver(() => {
      if (initialized) resizeCanvas(true);
    });
    resizeObserver.observe(canvas);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    hasSignatureRef.current = true;
    setHasSignature(true);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e?.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    isDrawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Unabhängig von der Display-Skalierung die komplette Pixelfläche leeren.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasSignatureRef.current = false;
    setHasSignature(false);
  };

  const saveSignature = () => {
    if (!hasSignature) {
      notify({ variant: 'warning', message: 'Bitte erstellen Sie zuerst eine Unterschrift.' });
      return;
    }

    if (!customerName.trim()) {
      notify({ variant: 'warning', message: `Bitte geben Sie den Namen des ${terminology.entity.genitive} ein.` });
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      notify({ variant: 'error', message: 'Fehler beim Zugriff auf das Unterschrift-Canvas.' });
      return;
    }
    
    try {
      // Check if canvas has content by analyzing image data
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        notify({ variant: 'error', message: 'Fehler beim Zugriff auf das Canvas-Kontext.' });
        return;
      }
      
      // Validate canvas dimensions before getting image data
      if (canvas.width === 0 || canvas.height === 0) {
        notify({ variant: 'error', message: 'Canvas-Größenfehler. Bitte versuchen Sie es erneut.' });
        return;
      }
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      let hasContent = false;
      
      // Check if there are any non-white pixels
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        
        // If pixel is not white (255, 255, 255) and not transparent
        if (a > 0 && (r < 255 || g < 255 || b < 255)) {
          hasContent = true;
          break;
        }
      }
      
      if (!hasContent) {
        notify({ variant: 'warning', message: 'Bitte erstellen Sie eine sichtbare Unterschrift.' });
        return;
      }
      
      const signatureData = canvas.toDataURL('image/png');
      
      // Validate that toDataURL worked correctly
      if (!signatureData || signatureData === 'data:,') {
        notify({ variant: 'error', message: 'Fehler beim Erstellen der Unterschrift-Daten. Bitte versuchen Sie es erneut.' });
        return;
      }
      
      // Additional validation for data URL format
      if (!signatureData.startsWith('data:image/png;base64,')) {
        notify({ variant: 'error', message: 'Ungültiges Unterschrift-Datenformat. Bitte versuchen Sie es erneut.' });
        return;
      }
      
      onSave(signatureData, customerName.trim());
      
    } catch (error) {
      logger.error('Error saving signature:', error);
      notify({ variant: 'error', message: 'Fehler beim Speichern der Unterschrift. Bitte versuchen Sie es erneut.' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-dialog-title"
      >
        <div className="flex shrink-0 items-center justify-between p-4 border-b border-gray-200">
          <h3 id="signature-dialog-title" className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Unterschrift schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {/* Customer Name Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Name des {terminology.entity.genitive} *
            </label>
            <input
              ref={customerNameInputRef}
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={200}
              placeholder={`Name des ${terminology.entity.genitive} eingeben...`}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom"
              required
            />
          </div>

          {/* Signature Canvas */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Unterschrift *
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-2">
              <canvas
                ref={canvasRef}
                className="w-full h-48 border border-gray-200 rounded cursor-crosshair touch-none"
                style={{ touchAction: 'none' }}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                onLostPointerCapture={() => { isDrawingRef.current = false; }}
              />
              <p className="text-xs text-gray-500 mt-2 text-center">
                Unterschrift hier mit der Maus oder dem Finger zeichnen
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={clearSignature}
              className="flex items-center justify-center space-x-2 px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors w-full sm:w-auto"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Löschen</span>
            </button>

            <div className="flex flex-col gap-2 sm:flex-row sm:space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors w-full sm:w-auto"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={saveSignature}
                className="flex items-center justify-center space-x-2 px-4 py-2 bg-primary-custom text-white rounded-lg hover:bg-primary-custom/90 transition-colors w-full sm:w-auto"
              >
                <Check className="h-4 w-4" />
                <span>Unterschrift speichern</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
