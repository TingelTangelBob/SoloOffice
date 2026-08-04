import React from 'react';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  defaultColor?: string;
}

export function ColorPicker({ label, value, onChange, defaultColor }: ColorPickerProps) {
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleReset = () => {
    if (defaultColor) {
      onChange(defaultColor);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="flex items-center space-x-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-gray-300" style={{ backgroundColor: value }}>
          <input
            type="color"
            value={value}
            onChange={handleColorChange}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`${label} auswählen`}
          />
        </div>
        <div className="flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#000000"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            pattern="^#[0-9A-Fa-f]{6}$"
          />
        </div>
        {defaultColor && (
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            title="Auf Standard zurücksetzen"
          >
            Standard
          </button>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <div 
          className="w-6 h-6 rounded-full border border-gray-300"
          style={{ backgroundColor: value }}
        ></div>
        <span className="text-sm text-gray-600">Vorschau</span>
      </div>
    </div>
  );
}
