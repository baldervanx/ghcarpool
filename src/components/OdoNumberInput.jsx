import React from 'react';
import { Input } from "@/components/ui/input";

const OdoNumberInput = ({ 
  originalValue = "", 
  inputValue = "", 
  onChange = () => {},
  className = ""
}) => {
  const handleChange = (e) => {
    const newValue = e.target.value;
    // Only allow numbers
    if (!/^\d*$/.test(newValue)) return;
    onChange(newValue);
  };

  // Calculate how much of the original value to show
  const unchangedPart = originalValue.slice(0, Math.max(0, originalValue.length - inputValue.length));

  return (
    <div className={`relative w-48 ${className}`}>
      <Input
        type="number"
        value={inputValue}
        onChange={handleChange}
        className="text-transparent bg-transparent caret-black font-mono"
      />
      <div className="absolute inset-0 flex items-center px-3 pointer-events-none font-mono">
        <span className="text-gray-500">{unchangedPart}</span>
        <span className="text-blue-600">{inputValue}</span>
      </div>
    </div>
  );
};

export default OdoNumberInput;
