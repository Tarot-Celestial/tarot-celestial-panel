'use client';
import { Phone } from 'lucide-react';
import { useStaffPanelCalls } from '@/providers/StaffPanelCallProvider';
import styles from './StaffPanelCall.module.css';

export default function StaffPanelCallButton({ threadId, targetWorkerId, targetName, disabled = false }: { threadId: string; targetWorkerId: string; targetName: string; disabled?: boolean }) {
  const calls = useStaffPanelCalls();
  const hint = calls?.busy ? 'Ya tienes una llamada abierta en este panel u otra pestaña.' : !calls?.enabled ? 'Conecta tu panel para llamar al equipo.' : `Llamar por audio al panel de ${targetName}`;
  return <button className={styles.callButton} type="button" disabled={disabled || !threadId || !calls?.enabled || calls.busy} onClick={() => void calls?.startCall({ threadId, targetWorkerId, targetName })} title={hint} aria-label={`Llamar al panel de ${targetName}`}><Phone size={18} /><span>Llamar</span></button>;
}
