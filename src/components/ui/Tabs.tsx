import React from "react";

interface TabsProps {
  tabs: string[];
  selected: string;
  onSelect: (tab: string) => void;
}

export function Tabs({ tabs, selected, onSelect }: TabsProps) {
  return (
    <div className="flex border-b">
      {tabs.map(tab => (
        <button
          key={tab}
          className={`px-4 py-2 -mb-px border-b-2 font-medium transition-colors duration-150 ${
            selected === tab
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-blue-500"
          }`}
          onClick={() => onSelect(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
