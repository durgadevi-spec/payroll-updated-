import { useState, useRef } from 'react';
import { compressImageFile, logoFormatFor } from '../../lib/imageUtils';
import { Plus, Trash2, Save, X, Eye, Upload, Layout, ImagePlus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PayslipTemplateContent } from '../../types/payslip';
import { DEFAULT_PAYSLIP_TEMPLATE } from '../../lib/defaultTemplate';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';

import { PayslipDocument } from './PayslipDocument';
import { ImageTemplateDesigner } from './ImageTemplateDesigner';
import { DEFAULT_PAYSLIP } from '../../lib/defaultTemplate';

interface Props {
  initialTemplate?: { id?: string; name: string; content: PayslipTemplateContent };
  /** Which mode a brand-new template starts in. Existing templates open in the mode they were saved in. */
  initialMode?: 'structured' | 'visual';
  onSave: () => void;
  onClose: () => void;
}

export function PayslipTemplateEditor({ initialTemplate, initialMode, onSave, onClose }: Props) {
  const { showToast } = useToast();
  const [name, setName] = useState(initialTemplate?.name || 'New Template');
  const [content, setContent] = useState<PayslipTemplateContent>(() => {
    const base = initialTemplate?.content || DEFAULT_PAYSLIP_TEMPLATE;
    return !initialTemplate && initialMode === 'visual' ? { ...base, type: 'visual' } : base;
  });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'header' | 'earnings' | 'deductions' | 'footer'>('header');
  const isImageMode = content.type === 'visual';
  const logoInputRef = useRef<HTMLInputElement>(null);

  const updateHeader = (updates: Partial<PayslipTemplateContent['header']>) => {
    setContent(prev => ({ ...prev, header: { ...prev.header, ...updates } }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const logoUrl = await compressImageFile(file, {
        maxWidth: 400,
        maxHeight: 400,
        format: logoFormatFor(file),
        quality: 0.9,
        maxBytes: 150 * 1024,
      });
      updateHeader({ logoUrl, logoText: '' });
      showToast('success', 'Logo added');
    } catch (err) {
      console.error('Logo upload error:', err);
      showToast('error', (err as Error).message || 'Failed to load logo image');
    } finally {
      input.value = ''; // allow choosing the same file again
    }
  };

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backgroundImage = await compressImageFile(file, {
        maxWidth: 1240,
        maxHeight: 1754,
        format: 'jpeg',
        quality: 0.85,
        maxBytes: 900 * 1024,
      });
      // New uploads show at full strength; the slider below lets you fade it.
      updateHeader({ backgroundImage, backgroundOpacity: 100 });
      showToast('success', 'Background image added');
    } catch (err) {
      console.error('Background upload error:', err);
      showToast('error', (err as Error).message || 'Failed to load background image');
    } finally {
      input.value = '';
    }
  };

  const addRow = (section: 'earnings' | 'deductions') => {
    setContent(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          rows: [...prev.sections[section].rows, { label: 'New Row', key: `custom_${Date.now()}` }]
        }
      }
    }));
  };

  const removeRow = (section: 'earnings' | 'deductions', index: number) => {
    setContent(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          rows: prev.sections[section].rows.filter((_, i) => i !== index)
        }
      }
    }));
  };

  const updateRow = (section: 'earnings' | 'deductions', index: number, label: string) => {
    setContent(prev => {
      const newRows = [...prev.sections[section].rows];
      newRows[index] = { ...newRows[index], label };
      return {
        ...prev,
        sections: { ...prev.sections, [section]: { ...prev.sections[section], rows: newRows } }
      };
    });
  };
  const switchMode = (mode: 'structured' | 'visual') => {
    setContent(prev => ({ ...prev, type: mode }));
  };

  // Carry the Standard-layout background image over so it becomes the editable image template.
  const useBackgroundAsTemplate = async () => {
    const src = content.header.backgroundImage;
    if (!src) return;
    try {
      const aspectRatio = await new Promise<number>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalHeight / img.naturalWidth);
        img.onerror = () => reject(new Error('Could not read the background image'));
        img.src = src;
      });
      setContent(prev => ({
        ...prev,
        type: 'visual',
        visualConfig: { backgroundImage: src, aspectRatio, fields: prev.visualConfig?.fields || [] },
      }));
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('error', 'Template name is required');
      return;
    }

    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        content,
        updated_at: new Date().toISOString(),
      };

      // Guard against oversized templates (huge embedded images) before hitting the database.
      const approxBytes = JSON.stringify(content).length;
      if (approxBytes > 4 * 1024 * 1024) {
        throw new Error('Template is too large (embedded images exceed 4 MB). Remove or replace the large image.');
      }

      if (content.type === 'visual' && !content.visualConfig?.backgroundImage) {
        throw new Error('Upload your payslip image first, or switch back to Standard layout.');
      }

      if (initialTemplate?.id) {
        const { data: rows, error } = await supabase.from('payslip_templates').update(data).eq('id', initialTemplate.id).select('id');
        if (error) throw new Error(error.message);
        if (!rows || rows.length === 0) throw new Error('Template was not updated (not found or not permitted).');
        showToast('success', 'Template updated successfully');
      } else {
        const { data: rows, error } = await supabase.from('payslip_templates').insert([data]).select('id');
        if (error) throw new Error(error.message);
        if (!rows || rows.length === 0) throw new Error('Template was not saved (not permitted).');
        showToast('success', 'Template saved successfully');
      }
      onSave();
    } catch (error) {
      console.error('Save template error:', error);
      showToast('error', `Failed to save template: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-50">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">Editing Template</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg font-bold bg-transparent border-none focus:ring-0 p-0 text-slate-800 dark:text-white"
              placeholder="Template Name..."
            />
          </div>

          <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 mx-2" />

          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            {([['structured', 'Standard layout', Layout], ['visual', 'Image template', ImagePlus]] as const).map(([mode, text, Icon]) => (
              <button
                key={mode}
                onClick={() => switchMode(mode)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${(mode === 'visual') === isImageMode
                  ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                  }`}
              >
                <Icon size={13} /> {text}
              </button>
            ))}
          </div>

          {!isImageMode && <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 mx-2" />}

          {!isImageMode && <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            {(['header', 'earnings', 'deductions', 'footer'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === tab
                  ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                  }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onClose} icon={<X size={16} />}>Cancel</Button>
          <Button
            loading={saving}
            onClick={handleSave}
            icon={<Save size={16} />}
            className="bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20"
          >
            Save Template
          </Button>
        </div>
      </div>

      {isImageMode ? (
        <ImageTemplateDesigner content={content} setContent={setContent} showToast={showToast} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-80 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-xl z-40">
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {activeTab === 'header' && (
                <div className="space-y-4">
                  <Input
                    label="Company Name"
                    value={content.header.title}
                    onChange={(e) => updateHeader({ title: e.target.value })}
                  />
                  <Input
                    label="Address"
                    value={content.header.address}
                    onChange={(e) => updateHeader({ address: e.target.value })}
                  />
                  <div className="flex items-center gap-2 mt-4">
                    <input
                      type="checkbox"
                      checked={content.header.showLogo}
                      onChange={(e) => updateHeader({ showLogo: e.target.checked })}
                      id="show-logo"
                    />
                    <label htmlFor="show-logo" className="text-sm">Show Logo</label>
                  </div>
                  {content.header.showLogo && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="Logo Text"
                          value={content.header.logoText}
                          onChange={(e) => updateHeader({ logoText: e.target.value, logoUrl: '' })}
                        />
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 mb-1">Or Upload Image</label>
                          <input
                            type="file"
                            ref={logoInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={handleLogoUpload}
                          />
                          <button
                            onClick={() => logoInputRef.current?.click()}
                            className="w-full border border-dashed border-slate-300 rounded p-2 text-xs flex items-center justify-center gap-2 hover:bg-slate-50 text-slate-600"
                          >
                            <Upload size={14} />
                            {content.header.logoUrl ? 'Change Logo' : 'Upload Logo'}
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Background Template (Reference)</label>
                        <p className="text-[10px] text-slate-400 mb-2">Upload an image of your existing PDF to use as a background.</p>
                        <input
                          type="file"
                          id="bg-upload"
                          className="hidden"
                          accept="image/*"
                          onChange={handleBackgroundUpload}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => document.getElementById('bg-upload')?.click()}
                            className="flex-1 border border-dashed border-slate-300 rounded p-3 text-xs flex items-center justify-center gap-2 hover:bg-slate-50 text-slate-600"
                          >
                            <Layout size={14} />
                            {content.header.backgroundImage ? 'Change Background' : 'Upload Template Image'}
                          </button>
                          {content.header.backgroundImage && (
                            <button
                              onClick={() => updateHeader({ backgroundImage: undefined })}
                              className="px-3 border border-slate-200 rounded text-red-500 hover:bg-red-50"
                              title="Remove Background"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        {content.header.backgroundImage && (
                          <button
                            onClick={useBackgroundAsTemplate}
                            className="mt-3 w-full text-xs font-semibold rounded-lg px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 flex items-center justify-center gap-2"
                          >
                            <ImagePlus size={14} /> Use this image as the template (edit on top)
                          </button>
                        )}
                        {content.header.backgroundImage && (
                          <div className="mt-3">
                            <label className="flex justify-between text-[10px] font-semibold text-slate-500 mb-1">
                              <span>Background Visibility</span>
                              <span>{content.header.backgroundOpacity ?? 40}%</span>
                            </label>
                            <input
                              type="range"
                              min={10}
                              max={100}
                              step={5}
                              value={content.header.backgroundOpacity ?? 40}
                              onChange={(e) => updateHeader({ backgroundOpacity: parseInt(e.target.value) })}
                              className="w-full"
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {(activeTab === 'earnings' || activeTab === 'deductions') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold">{activeTab.toUpperCase()} Rows</h3>
                    <Button size="sm" variant="outline" onClick={() => addRow(activeTab)} icon={<Plus size={14} />}>Add Row</Button>
                  </div>
                  {content.sections[activeTab].rows.map((row: { label: string; key: string; isTotal?: boolean }, index: number) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={row.label}
                        onChange={(e) => updateRow(activeTab, index, e.target.value)}
                        className="flex-1"
                      />
                      <button
                        onClick={() => removeRow(activeTab, index)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                        disabled={row.isTotal}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'footer' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">Remarks / Footer Notes</h3>
                  {content.sections.footer.remarks.map((remark, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={remark}
                        onChange={(e) => {
                          const newRemarks = [...content.sections.footer.remarks];
                          newRemarks[index] = e.target.value;
                          setContent(prev => ({ ...prev, sections: { ...prev.sections, footer: { ...prev.sections.footer, remarks: newRemarks } } }));
                        }}
                        className="flex-1"
                      />
                      <button
                        onClick={() => {
                          const newRemarks = content.sections.footer.remarks.filter((_, i) => i !== index);
                          setContent(prev => ({ ...prev, sections: { ...prev.sections, footer: { ...prev.sections.footer, remarks: newRemarks } } }));
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    icon={<Plus size={14} />}
                    onClick={() => setContent(prev => ({ ...prev, sections: { ...prev.sections, footer: { ...prev.sections.footer, remarks: [...prev.sections.footer.remarks, ''] } } }))}
                  >
                    Add Remark
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Main Workspace (Canvas Area) */}
          <div className="flex-1 bg-slate-200 dark:bg-slate-950 overflow-auto relative p-12 flex justify-center custom-scrollbar">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-full border border-white dark:border-slate-700 shadow-sm text-[10px] font-medium text-slate-500">
              <Eye size={12} className="text-blue-500" />
              Live Preview Mode
            </div>
            <div className="transform scale-[0.8] origin-top">
              <PayslipDocument
                payslip={DEFAULT_PAYSLIP}
                templateContent={content}
                editable={true}
                onAddRow={(section) => addRow(section)}
                onRemoveRow={(section, index) => removeRow(section, index)}
                onUpdateLabel={(section, index, label) => updateRow(section, index, label)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}