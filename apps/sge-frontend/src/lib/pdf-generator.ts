import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface BoletaData {
  estudiante: {
    nombres: string;
    apellidos: string;
    cedula_escolar: string;
    grado_seccion: string;
    ano_escolar: string;
  };
  periodo_config: {
    sistema_evaluacion: string;
    nombre_periodo: string;
  };
  calificaciones_lapsos: Array<{
    asignatura: string;
    lapso_1: number | null;
    lapso_2: number | null;
    lapso_3: number | null;
    nota_definitiva_anual: number | null;
    literal_cualitativo: string | null;
  }>;
  asistencia_resumen: {
    clases_totales: number;
    asistencias: number;
    inasistencias: number;
    justificadas: number;
    porcentaje_inasistencia: number;
  };
}

export function generateBoletaPDF(data: BoletaData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let y = 15;

  // Helper functions
  const drawText = (text: string, x: number, y: number, options: { fontSize?: number; fontStyle?: string; color?: string; align?: 'left' | 'center' | 'right' } = {}) => {
    const { fontSize = 10, fontStyle = 'normal', color = '#0f172a', align = 'left' } = options;
    doc.setFontSize(doc, fontSize);
    doc.setFont(undefined, fontStyle);
    doc.setTextColor(color);
    doc.text(text, x, y, { align });
  };

  const addHeader = () => {
    // School header
    doc.setFillColor('#2563eb');
    doc.rect(0, 0, pageWidth, 30, 'F');
    
    doc.setTextColor('#ffffff');
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('SISTEMA DE GESTIÓN ESCOLAR', pageWidth / 2, 12, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('A2LT Soluciones - Boleta de Notas Oficial', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(8);
    doc.text(`Período: ${data.periodo_config.nombre_periodo}`, pageWidth / 2, 26, { align: 'center' });
  };

  const addStudentInfo = () => {
    y = 38;
    
    // Student info box
    doc.setDrawColor('#e2e8f0');
    doc.setLineWidth(0.3);
    doc.roundedRect(15, y, pageWidth - 30, 28, 3, 'D');
    
    y += 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor('#0f172a');
    doc.text('DATOS DEL ESTUDIANTE', 18, y);
    
    y += 6;
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor('#475569');
    
    const info = [
      { label: 'Apellidos y Nombres:', value: `${data.estudiante.apellidos}, ${data.estudiante.nombres}` },
      { label: 'Cédula Escolar:', value: data.estudiante.cedula_escolar },
      { label: 'Grado y Sección:', value: data.estudiante.grado_seccion },
      { label: 'Año Escolar:', value: data.estudiante.ano_escolar },
    ];
    
    info.forEach((item, i) => {
      const rowY = y + (i * 5);
      doc.setFont(undefined, 'bold');
      doc.text(item.label, 18, rowY);
      doc.setFont(undefined, 'normal');
      doc.text(item.value, 60, rowY);
    });
  };

  const addGradesTable = () => {
    y = 75;
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor('#0f172a');
    doc.text('CALIFICACIONES POR LAPSO', 15, y);
    
    y += 4;
    
    // Prepare table data
    const tableData = data.calificaciones_lapsos.map(item => [
      item.asignatura,
      item.lapso_1 !== null ? item.lapso_1.toFixed(1) : '---',
      item.lapso_2 !== null ? item.lapso_2.toFixed(1) : '---',
      item.lapso_3 !== null ? item.lapso_3.toFixed(1) : '---',
      item.nota_definitiva_anual !== null ? item.nota_definitiva_anual.toFixed(1) : '---',
      item.literal_cualitativo || '---',
    ]);
    
    autoTable(doc, {
      startY: y,
      head: [['Asignatura', 'Lapso 1', 'Lapso 2', 'Lapso 3', 'Definitiva', 'Literal']],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: [255, 255, 255],
        fontSize: 7,
        fontStyle: 'bold',
        halign: 'center',
      },
      bodyStyles: {
        fontSize: 7,
        halign: 'center',
        textColor: '#0f172a',
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 50 },
        1: { cellWidth: 18 },
        2: { cellWidth: 18 },
        3: { cellWidth: 18 },
        4: { cellWidth: 18 },
        5: { cellWidth: 18 },
      },
      margin: { left: 15, right: 15 },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
    });
    
    y = (doc as any).lastAutoTable.finalY + 5;
  };

  const addAttendanceSummary = () => {
    const asistencia = data.asistencia_resumen;
    
    if (y > 250) {
      doc.addPage();
      y = 15;
    }
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor('#0f172a');
    doc.text('RESUMEN DE ASISTENCIA', 15, y);
    
    y += 6;
    
    const attendanceData = [
      ['Clases Totales', asistencia.clases_totales.toString()],
      ['Asistencias', asistencia.asistencias.toString()],
      ['Inasistencias', asistencia.inasistencias.toString()],
      ['Justificadas', asistencia.justificadas.toString()],
      ['% Inasistencia', `${asistencia.porcentaje_inasistencia}%`],
    ];
    
    autoTable(doc, {
      startY: y,
      body: attendanceData,
      theme: 'plain',
      bodyStyles: {
        fontSize: 8,
        textColor: '#0f172a',
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
        1: { halign: 'center', cellWidth: 30 },
      },
      margin: { left: 15, right: 15 },
    });
    
    y = (doc as any).lastAutoTable.finalY + 5;
  };

  const addFooter = () => {
    const footerY = pageHeight - 15;
    
    doc.setDrawColor('#e2e8f0');
    doc.setLineWidth(0.3);
    doc.line(15, footerY - 5, pageWidth - 15, footerY - 5);
    
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.setTextColor('#94a3b8');
    doc.text('Sistema de Gestión Escolar - A2LT Soluciones', pageWidth / 2, footerY, { align: 'center' });
    doc.text(`Documento generado el ${new Date().toLocaleDateString('es-VE')}`, pageWidth / 2, footerY + 4, { align: 'center' });
    doc.text('Este documento es válido sin firma física según normativa vigente', pageWidth / 2, footerY + 8, { align: 'center' });
  };

  // Generate PDF
  addHeader();
  addStudentInfo();
  addGradesTable();
  addAttendanceSummary();
  addFooter();
  
  return doc;
}

export function downloadBoletaPDF(data: BoletaData, filename?: string): void {
  const doc = generateBoletaPDF(data);
  const filename = filename || `boleta_${data.estudiante.cedula_escolar}_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}