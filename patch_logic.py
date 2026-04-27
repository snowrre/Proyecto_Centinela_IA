import os

with open(r'c:\Users\sergio\Desktop\Proyecto_Centinela_IA\logic.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update init models
import re

init_start = content.find("        # ── HandLandmarker")
init_end = content.find("        # ── Umbrales de gaze")
if init_start != -1 and init_end != -1:
    new_init = "        # ── YOLOv8 (v2.0 Híbrida) ───────────────\n        self.yolo_model = YOLO(\"yolov8n.pt\")\n\n"
    content = content[:init_start] + new_init + content[init_end:]


# 2. Update pipeline functions
# Find where _analyze_hands begins
fns_start = content.find("    def _analyze_hands")
# Find where release begins
release_start = content.find("    def release(self):")

new_pipeline = """    def analyze_frame(self, bgr_frame: np.ndarray) -> SuspicionReport:
        now_t = time.time()
        fps = int(1.0 / max(now_t - self._last_time, 0.001) + 0.5)
        self._last_time = now_t
        
        h, w   = bgr_frame.shape[:2]
        rgb    = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        gaze, face_lms = self._analyze_gaze(mp_img, w, h)
        
        # ── Inferencias YOLOv8 ──────────────────────────────────────────────────
        yolo_results = self.yolo_model(rgb, classes=[0, 67], verbose=False)[0]
        
        cell_phone_detected = False
        person_count = 0
        yolo_boxes = []
        
        for box in yolo_results.boxes:
            cls_id = int(box.cls[0].item())
            conf = float(box.conf[0].item())
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            
            if cls_id == 0:
                person_count += 1
            elif cls_id == 67:
                cell_phone_detected = True
                
            name = "Person" if cls_id == 0 else "Cell Phone"
            yolo_boxes.append({"class": cls_id, "name": name, "conf": conf, "box": [x1, y1, x2, y2]})
            
        objects = ObjectResult(cell_phone_detected, person_count, yolo_boxes)

        pitch_raw = gaze.pitch_angle + self._gaze_offset_pitch
        fat       = self._analyze_fatigue(face_lms,
                                          pitch_adj=gaze.pitch_angle,
                                          pitch_raw=pitch_raw)

        flags = []
        if not gaze.landmarks_detected:
            flags.append("Cara no detectada")
        elif gaze.suspicion:
            flags.append(f"Mirada {gaze.gaze_direction} (yaw={gaze.yaw_angle:.1f}°)")

        if cell_phone_detected:
            flags.append("Dispositivo detectado")
        if person_count > 1:
            flags.append("Persona no autorizada")

        if fat.drowsy:      flags.append(f"Cansancio (EAR={fat.ear_avg:.2f})")
        elif fat.head_nodding: flags.append(f"Cabeceo (pitch={gaze.pitch_angle:.1f}°)")

        nf = len(flags)
        if nf == 0:
            self._susp_streak_start = None
            level = SuspicionLevel.NORMAL
            # Decay
            self._risk_score = max(0.05, self._risk_score - 0.02)
        else:
            now = time.time()
            if self._susp_streak_start is None:
                self._susp_streak_start = now
            streak = now - self._susp_streak_start

            only_soft = (nf == 1) and (gaze.suspicion or fat.drowsy or fat.head_nodding)

            if streak >= 4.0 and not only_soft:
                level = SuspicionLevel.CRITICO
                target_conf = 0.92 if nf > 1 else 0.85
            else:
                level = SuspicionLevel.ALERTA
                if nf == 1 and gaze.suspicion:
                    target_conf = 0.60
                else:
                    target_conf = 0.72 if nf > 1 else 0.55
                
            if self._risk_score < target_conf:
                self._risk_score = min(target_conf, self._risk_score + 0.05)
            else:
                self._risk_score = max(target_conf, self._risk_score - 0.02)
                
            # ── Reglas Estrictas de Examen ───────────────────────────
            # 1. Gaze Extremo
            if abs(gaze.yaw_angle) > 45.0 or abs(gaze.pitch_angle) > 45.0:
                self._risk_score = min(1.0, self._risk_score + 0.15)
                
            # 2. Objetos (YOLO)
            if cell_phone_detected:
                self._risk_score = min(1.0, self._risk_score + 0.25)
            if person_count > 1:
                self._risk_score = min(1.0, self._risk_score + 0.50)
                
            # Escala
            if self._risk_score >= 0.85:
                level = SuspicionLevel.CRITICO
            elif self._risk_score >= 0.50 and level == SuspicionLevel.NORMAL:
                level = SuspicionLevel.ALERTA

        cara  = (f"Mirando {gaze.gaze_direction}" if gaze.landmarks_detected else "Cara no detectada")
        obj_t = (f"Teléfono: {'SI' if cell_phone_detected else 'NO'} | "
                 f"Personas: {person_count}")
        fat_t = (f"Fatiga EAR={fat.ear_avg:.2f} ({'SOMNOLIENTO' if fat.drowsy else 'alerta'})")

        prompt = (
            f"Vigilancia de examen:\\n"
            f"- Gaze: {cara}\\n"
            f"- Objetos: {obj_t}\\n"
            f"- {fat_t}\\n"
            f"- {'Indicadores: ' + '; '.join(flags) if flags else 'Sin sospecha.'}\\n\\n"
            f"¿Hay intento de trampa o material no permitido? Responde corto."
        )

        return SuspicionReport(
            level=level, gaze=gaze, objects=objects, fatigue=fat,
            reasoning_text=prompt, confidence=round(self._risk_score, 2), timestamp=time.time(),
            fps=fps
        )

    # ────────────────── Overlays de monitoreo ────────────────────────────────

    def draw_overlays(self, bgr_frame: np.ndarray, report: SuspicionReport) -> np.ndarray:
        frame       = bgr_frame.copy()
        h, w        = frame.shape[:2]
        cmap = {
            SuspicionLevel.NORMAL:  (0, 200, 100),
            SuspicionLevel.ALERTA:  (0, 165, 255),
            SuspicionLevel.CRITICO: (0,   0, 255),
        }
        color = cmap[report.level]
        thick = 3 if report.level == SuspicionLevel.NORMAL else 6
        cv2.rectangle(frame, (0,0), (w-1,h-1), color, thick)

        # ── Boxes YOLOv8 ──────────────────────────────────────────────
        for b in report.objects.yolo_boxes:
            x1, y1, x2, y2 = b["box"]
            cls_id = b["class"]
            conf = b["conf"]
            name = b["name"]
            
            box_col = (0, 0, 255) if cls_id == 67 else (0, 165, 255) # Red for phone, Orange for person
            cv2.rectangle(frame, (x1, y1), (x2, y2), box_col, 2)
            cv2.putText(frame, f"{name} {conf*100:.0f}%", (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, box_col, 2)

        # ── HUD de texto ──────────────────────────────────────────────────────
        font = cv2.FONT_HERSHEY_SIMPLEX; y = 28
        g, ob, ft = report.gaze, report.objects, report.fatigue

        cv2.putText(frame, f"NIVEL: {report.level.name}", (10,y), font, 0.8, color, 2); y += 30
        gaze_txt = (f"Gaze:{g.gaze_direction} y={g.yaw_angle:.1f} p={g.pitch_angle:.1f}"
                    if g.landmarks_detected else "Cara: NO DETECTADA")
        cv2.putText(frame, gaze_txt, (10,y), font, 0.44, (240,240,240), 1); y += 18
        
        obj_col = (0,80,255) if (ob.cell_phone_detected or ob.person_count > 1) else (240,240,240)
        cv2.putText(frame, f"Objetos: {ob.person_count}p, cel:{ob.cell_phone_detected}",
                    (10,y), font, 0.44, obj_col, 1); y += 18
                    
        fat_col = (0,80,255) if ft.drowsy else (240,240,240)
        cv2.putText(frame, f"EAR:{ft.ear_avg:.2f} {'SOMNOLIENTO' if ft.drowsy else 'ok'}",
                    (10,y), font, 0.44, fat_col, 1); y += 18
                    
        cv2.putText(frame, f"Conf:{report.confidence*100:.0f}%", (10,y), font, 0.44, color, 1)
        return frame\n\n"""

content = content[:fns_start] + new_pipeline + content[release_start:]

# 3. Update release function
res_start = content.find("    def release")
if res_start != -1:
    content = content[:res_start] + "    def release(self):\n        self.face_landmarker.close()\n        print(\"[ProctorVision v2.0] Recursos liberados.\")\n"

with open(r'c:\Users\sergio\Desktop\Proyecto_Centinela_IA\logic.py', 'w', encoding='utf-8') as f:
    f.write(content)
