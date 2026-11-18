import React from 'react';
import { PauseCircle } from 'lucide-react';
import type { SystemAiConfig } from '../../core/types';

export const MaintenanceBanner: React.FC<{ config: Pick<SystemAiConfig, 'enabled' | 'maintenanceMessage'> | null }> = ({
  config,
}) => {
  if (!config || config.enabled) return null;
  return (
    <div
      role="status"
      className="mx-auto max-w-7xl px-4 sm:px-6 pt-3"
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 backdrop-blur-md px-4 py-3 flex items-start gap-3 text-amber-950 shadow-xs">
        <PauseCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold">Dịch vụ xử lý AI đang tạm ngừng</p>
          <p className="text-amber-900/90 mt-0.5">
            {config.maintenanceMessage ||
              'StudyCheck AI đang tạm ngừng xử lý AI. Những tài liệu và kết quả đã lưu vẫn có thể được truy cập bình thường.'}
          </p>
        </div>
      </div>
    </div>
  );
};
