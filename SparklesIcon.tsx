import React from 'react';

const SparklesIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    fill="none" 
    viewBox="0 0 24 24" 
    strokeWidth={1.5} 
    stroke="currentColor" 
    {...props}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L1.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.25 12L17 13.75l-1.25-1.75L14.25 12l1.5-1.25L17 9.25l1.25 1.5L19.75 12h0zM9.813 15.904L9 18.75l-.813-2.846m0 0A4.5 4.5 0 005.096 12.96L1.25 12l3.846-.096m0 0A4.5 4.5 0 009 5.25l.813 2.846M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21" />
  </svg>
);

export default SparklesIcon;