import React, { useRef, useState, useEffect } from 'react';
import logger from '../utils/logger';
import { X, RotateCcw, Check } from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { getTerminology } from '../utils/terminology';

interface SignaturePadProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (signatureData: string, customerName: string) => void;
  title?: string;
  initialCustomerName?: string;
}

export function SignaturePad({ isOpen, onClose, onSave, title = "Unterschrift", initialCustomerName = "" }: SignaturePadProps) {
  const { company } = useCompany();
  const terminology = getTerminology(company.terminologyProfile);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    setCustomerName(initialCustomerName);
  }, [initialCustomerName]);

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      // Add a small delay to ensure canvas is fully rendered
      const initCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Set canvas size to match display size (no scaling for simplicity)
        const rect = canvas.getBoundingClientRect();
        
        // Ensure we have valid dimensions
        const width = Math.max(rect.width, 200);
        const height = Math.max(rect.height, 100);
        
        canvas.width = width;
        canvas.height = height;
        
        // Set background and drawing properties
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.imageSmoothingEnabled = true;
      };
      
      // Initialize immediately and after a small delay
      initCanvas();
      const timeoutId = setTimeout(initCanvas, 100);
      
      // Handle orientation change and resize
      const handleResize = () => {
        setTimeout(initCanvas, 100);
        setHasSignature(false);
      };
      
      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', handleResize);
      
      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
      };
    }
  }, [isOpen]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    setHasSignature(true);
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let clientX, clientY;
    if ('touches' in e) {
      e.preventDefault(); // Prevent scrolling on mobile
      const touch = e.touches[0] || e.changedTouches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Calculate coordinates relative to canvas
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let clientX, clientY;
    if ('touches' in e) {
      e.preventDefault(); // Prevent scrolling
      const touch = e.touches[0] || e.changedTouches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Calculate coordinates relative to canvas
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e?: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (e && 'touches' in e) {
      e.preventDefault();
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear with white background using canvas dimensions
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const saveSignature = () => {
    if (!hasSignature) {
      alert('Bitte erstellen Sie zuerst eine Unterschrift.');
      return;
    }

    if (!customerName.trim()) {
      alert(`Bitte geben Sie den Namen des ${terminology.entity.genitive} ein.`);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      alert('Fehler beim Zugriff auf das Unterschrift-Canvas.');
      return;
    }
    
    try {
      // Check if canvas has content by analyzing image data
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        alert('Fehler beim Zugriff auf das Canvas-Kontext.');
        return;
      }
      
      // Validate canvas dimensions before getting image data
      if (canvas.width === 0 || canvas.height === 0) {
        alert('Canvas-Größenfehler. Bitte versuchen Sie es erneut.');
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
        alert('Bitte erstellen Sie eine sichtbare Unterschrift.');
        return;
      }
      
      const signatureData = canvas.toDataURL('image/png');
      
      // Validate that toDataURL worked correctly
      if (!signatureData || signatureData === 'data:,') {
        alert('Fehler beim Erstellen der Unterschrift-Daten. Bitte versuchen Sie es erneut.');
        return;
      }
      
      // Additional validation for data URL format
      if (!signatureData.startsWith('data:image/png;base64,')) {
        alert('Ungültiges Unterschrift-Datenformat. Bitte versuchen Sie es erneut.');
        return;
      }
      
      onSave(signatureData, customerName.trim());
      
    } catch (error) {
      logger.error('Error saving signature:', error);
      alert('Fehler beim Speichern der Unterschrift. Bitte versuchen Sie es erneut.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Customer Name Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Name des {terminology.entity.genitive} *
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
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
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                onTouchCancel={stopDrawing}
              />
              <p className="text-xs text-gray-500 mt-2 text-center">
                Unterschrift hier mit der Maus oder dem Finger zeichnen
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-4">
            <button
              onClick={clearSignature}
              className="flex items-center space-x-2 px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Löschen</span>
            </button>

            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={saveSignature}
                className="flex items-center space-x-2 px-4 py-2 bg-primary-custom text-white rounded-lg hover:bg-primary-custom/90 transition-colors"
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
