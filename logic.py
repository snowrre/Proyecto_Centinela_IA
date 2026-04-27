"""
logic.py - Centinela IA v1.51  —  Integración Tri-Modelo + Calibración Dinámica
════════════════════════════════════════════════════════════════════════════════
Modelos activos: FaceLandmarker · HandLandmarker · PoseLandmarker (NUEVO)
"""

import math, time, datetime, cv2, numpy as np
from ultralytics import YOLO
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision

BASE_DIR        = Path(__file__).parent
FACE_MODEL_PATH = str(BASE_DIR / "models" / "face_landmarker.task")
HAND_MODEL_PATH = str(BASE_DIR / "models" / "hand_landmarker.task")
POSE_MODEL_PATH = str(BASE_DIR / "models" / "pose_landmarker.task")

# ── Constantes de gaze ────────────────────────────────────────────────────────
YAW_WARNING_DEG  = 20.0
YAW_CRITICAL_DEG = 35.0
PITCH_THRESHOLD  = 20.0

# ── Índices FaceLandmarker (478 pts) ─────────────────────────────────────────
NOSE_TIP     = 1
LEFT_EAR_LM  = 234   # oreja en face mesh (para yaw/pitch)
RIGHT_EAR_LM = 454
CHIN         = 152
FOREHEAD     = 10

# 6 puntos por ojo para EAR (Soukupová & Čech, 2016)
L_EYE_6 = (33, 160, 158, 133, 153, 144)   # ojo izquierdo
R_EYE_6 = (362, 385, 387, 263, 373, 380)  # ojo derecho

# ── Índices PoseLandmarker (33 pts) ──────────────────────────────────────────
POSE_EAR_L      = 7
POSE_EAR_R      = 8
POSE_SHOULDER_L = 11
POSE_SHOULDER_R = 12
POSE_ELBOW_L    = 13
POSE_ELBOW_R    = 14
POSE_HIP_L      = 23
POSE_HIP_R      = 24

# ── Umbrales ─────────────────────────────────────────────────────────────────
EAR_THRESHOLD        = 0.22   # fallback si aún no se calibró
EAR_FRAMES           = 40     # (v1.8 RC) debounce fatiga: ~2s @ 20fps — evita falsos por parpadeo/lectura
PITCH_NOD_DEG        = 15.0
CAL_FRAMES           = 100    # frames de calibración de perspectiva
GAZE_DEADZONE_DEG    = 20.0   # (v1.7) zona de confort — nunca alerta por debajo de este ángulo
CRITICAL_DEBOUNCE_S  = 5.0    # (v1.8 Definitiva) segundos continuos para alcanzar CRÍTICO
SHOULDER_STAND_FRAC  = 0.30   # (v1.7) cambio >30% en Y de hombros = persona se levantó

# ── Margen lateral del polígono de trabajo (fraccion del ancho del frame) ────────
TORSO_MARGIN_FRAC  = 0.08          # margen fijo base    (se aumenta +20% dinámicamente)
ELBOW_ALERT_SECS   = 3.0           # segundos fuera de zona para disparar alerta de codos

# ── Motor de Reglas: Límites de tiempo (segundos continuos) ───────────────────
CELL_PHONE_LIMIT  = 2.0
DISTRACTION_LIMIT = 5.0
ABSENCE_LIMIT     = 4.0

# ── Conexiones del esqueleto de Pose (33 puntos) ───────────────────────────────
POSE_CONNECTIONS = [
    # Torso
    (11, 12), (11, 23), (12, 24), (23, 24),
    # Brazo izquierdo
    (11, 13), (13, 15), (15, 17), (15, 19), (15, 21),
    # Brazo derecho
    (12, 14), (14, 16), (16, 18), (16, 20), (16, 22),
    # Pierna izquierda
    (23, 25), (25, 27), (27, 29), (27, 31),
    # Pierna derecha
    (24, 26), (26, 28), (28, 30), (28, 32),
    # Cara (mínimo)
    (0, 1), (1, 2), (2, 3), (3, 7),
    (0, 4), (4, 5), (5, 6), (6, 8),
    (9, 10),
]

# ═════════════════════════════ Dataclasses ═══════════════════════════════════

class SuspicionLevel(Enum):
    NORMAL = 0; ALERTA = 1; CRITICO = 2

@dataclass
class GazeResult:
    yaw_angle: float; pitch_angle: float; gaze_direction: str
    suspicion: bool;  landmarks_detected: bool

@dataclass
class FatigueResult:
    ear_avg:        float
    ear_left:       float
    ear_right:      float
    eyes_closing:   bool
    low_ear_streak: int
    drowsy:         bool
    head_nodding:   bool
    fatigue_score:  float

@dataclass
class ObjectResult:
    cell_phone_detected: bool
    book_detected: bool
    person_count: int
    yolo_boxes: list  # [{'class': int, 'name': str, 'conf': float, 'box': [x1,y1,x2,y2]}]
    raw_results: Optional[object] = None # Almacena el objeto Results de YOLO para .plot()

@dataclass
class SuspicionReport:
    level:          SuspicionLevel
    gaze:           GazeResult
    objects:        ObjectResult
    fatigue:        FatigueResult
    reasoning_text: str
    confidence:     float
    active_violations: list = field(default_factory=list)
    timestamp:      float = field(default_factory=time.time)
    fps:            int = 24

    @property
    def needs_ai_review(self):
        return self.level in (SuspicionLevel.ALERTA, SuspicionLevel.CRITICO)

    def to_dict(self, student_id: int = 1) -> dict:
        return {
            "student_id": student_id,
            "risk_score": int(self.confidence * 100),
            "gaze": self.gaze.gaze_direction,
            "level": self.level.name,
            "cell_phone": self.objects.cell_phone_detected,
            "book": self.objects.book_detected,
            "person_count": self.objects.person_count,
            "timestamp": round(self.timestamp, 3)
        }

@dataclass
class SetupStatus:
    """Estado del Setup Wizard (cara + distancia)."""
    face_detected:   bool
    eyes_detected:   bool
    face_size_pct:   float
    distance_status: str
    distance_ok:     bool
    ready:           bool

    @property
    def distance_msg(self) -> str:
        return {
            "TOO_CLOSE": "Estás muy cerca — aléjate ~20cm",
            "TOO_FAR":   "Estás muy lejos — acércate un poco",
            "OK":        "Distancia perfecta",
            "NO_FACE":   "No se detecta rostro",
        }.get(self.distance_status, "")

    @property
    def checklist(self) -> list:
        return [
            ("Cara detectada",          self.face_detected),
            ("Ojos visibles al frente", self.eyes_detected),
            ("Distancia correcta",      self.distance_ok),
        ]

# ═════════════════════════════ Clase Principal ═══════════════════════════════

class ProctorVision:

    def __init__(self):
        # ── FaceLandmarker ───────────────────────────────────────────────────
        face_opts = mp_vision.FaceLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=FACE_MODEL_PATH),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.6,
            min_face_presence_confidence=0.6,
            min_tracking_confidence=0.5,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        )
        self.face_landmarker = mp_vision.FaceLandmarker.create_from_options(face_opts)

        # ── YOLOv8 (v2.0 Híbrida) ───────────────
        self.yolo_model = YOLO("yolov8n.pt")
        self._yolo_frame_counter = 0
        self._last_objects = ObjectResult(False, False, 0, [], None)

        # ── Umbrales de gaze ─────────────────────────────────────────────────
        self._yaw_warning  = YAW_WARNING_DEG
        self._yaw_critical = YAW_CRITICAL_DEG
        self._pitch_thresh = PITCH_THRESHOLD

        # ── Historiales de suavizado (Media Móvil 10 frames) ──────────────────
        self._yaw_history:   list = []
        self._pitch_history: list = []
        self._HISTORY_LEN = 10   # ← 10 frames (era 5): filtra ruido cámara

        # ── EAR streak (debounce fatiga) ──────────────────────────────────────
        self._low_ear_streak: int = 0
        
        self._risk_score: float = 0.05
        self._last_time: float = time.time()

        # ── Debounce CRÍTICO: temporizador de sospecha continua (v1.7 = 4s) ───────
        self._susp_streak_start: Optional[float] = None

        # ── v1.7: Sticky Shoulders (ancla de posición de hombros) ────────────────
        self._shoulder_anchor_y: Optional[float] = None

        # ── v1.4: Offset de perspectiva de cámara ────────────────────────────
        self._gaze_offset_yaw:   float = 0.0
        self._gaze_offset_pitch: float = 0.0

        # ── v1.5: Calibración de perspectiva ─────────────────────────────────
        self._base_ear:         float = 0.0
        self._base_pitch:       float = 0.0
        self._cal_ears:    list = []
        self._cal_pitches: list = []

        # ── v1.5.1: Filtro de ruido y debounce de codos ────────────────────────
        self._last_pose:        Optional[object] = None
        self._no_pose_count:    int              = 0
        # ── v1.6: Motor de Reglas (Temporizadores de estado) ─────────────────
        self._cell_phone_start:   Optional[float] = None
        self._distraction_start:  Optional[float] = None
        self._absence_start:      Optional[float] = None
        self._last_violations:    set = set()

        print("[ProctorVision v1.5.1] Inicializado [OK] — 3 modelos + Revert Humilde")

    def set_device_mode(self, mode: str):
        if mode == "tablet":
            self._yaw_warning = 30.0; self._yaw_critical = 48.0; self._pitch_thresh = 28.0
        else:
            self._yaw_warning  = YAW_WARNING_DEG
            self._yaw_critical = YAW_CRITICAL_DEG
            self._pitch_thresh = PITCH_THRESHOLD

    def calibrate_gaze_offset(self, bgr_frame: np.ndarray) -> dict:
        h, w   = bgr_frame.shape[:2]
        rgb    = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res    = self.face_landmarker.detect(mp_img)
        if not res.face_landmarks:
            return {"success": False, "yaw_offset": self._gaze_offset_yaw, "pitch_offset": self._gaze_offset_pitch}
        lms        = res.face_landmarks[0]
        yaw, pitch = self._head_angles(lms, w, h)
        self._gaze_offset_yaw   = round(yaw, 2)
        self._gaze_offset_pitch = round(pitch, 2)
        return {"success": True, "yaw_offset": self._gaze_offset_yaw, "pitch_offset": self._gaze_offset_pitch}

    def set_gaze_offset(self, yaw: float, pitch: float) -> None:
        self._gaze_offset_yaw   = yaw
        self._gaze_offset_pitch = pitch

    def start_calibration(self) -> None:
        self._cal_ears    = []
        self._cal_pitches = []

    def process_calibration_frame(self, bgr_frame: np.ndarray) -> tuple:
        h, w   = bgr_frame.shape[:2]
        rgb    = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        face_res = self.face_landmarker.detect(mp_img)
        cur_ear = 0.0; cur_pitch = 0.0
        if face_res.face_landmarks:
            lms = face_res.face_landmarks[0]
            ear_l = self._ear(lms, L_EYE_6); ear_r = self._ear(lms, R_EYE_6)
            cur_ear = (ear_l + ear_r) / 2.0
            _, cur_pitch = self._head_angles(lms, w, h)
            self._cal_ears.append(cur_ear)
            self._cal_pitches.append(cur_pitch)
        progress = min(len(self._cal_ears) / CAL_FRAMES, 1.0)
        done     = len(self._cal_ears) >= CAL_FRAMES
        if done and self._base_ear == 0.0:
            self._base_ear   = float(np.mean(self._cal_ears)) if self._cal_ears else EAR_THRESHOLD
            self._base_pitch = float(np.mean(self._cal_pitches)) if self._cal_pitches else 0.0
        return done, progress, round(cur_ear, 3), round(cur_pitch, 1)

    def set_perspective_params(self, base_ear: float, base_pitch: float) -> None:
        self._base_ear = base_ear; self._base_pitch = base_pitch

    def validate_setup(self, bgr_frame: np.ndarray) -> SetupStatus:
        rgb    = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        face_res = self.face_landmarker.detect(mp_img)
        face_detected = bool(face_res.face_landmarks)
        eyes_detected = False; face_size_pct = 0.0; distance_status = "NO_FACE"
        if face_detected:
            lms = face_res.face_landmarks[0]
            nose = lms[NOSE_TIP]; left_eye = lms[33]; right_eye = lms[263]
            forehead = lms[FOREHEAD]; chin_lm = lms[CHIN]
            eye_spread = abs(right_eye.x - left_eye.x)
            eyes_detected = (left_eye.x < nose.x + 0.05 and right_eye.x > nose.x - 0.05 and eye_spread > 0.07)
            face_size_pct = abs(chin_lm.y - forehead.y) * 100.0
            if face_size_pct > 45: distance_status = "TOO_CLOSE"
            elif face_size_pct < 15: distance_status = "TOO_FAR"
            else: distance_status = "OK"
        return SetupStatus(face_detected, eyes_detected, face_size_pct, distance_status, distance_status == "OK", face_detected and eyes_detected and distance_status == "OK")

    def draw_setup_overlay(self, bgr_frame: np.ndarray, status: SetupStatus, unlock_progress: float = 0.0) -> np.ndarray:
        frame = bgr_frame.copy(); h, w = frame.shape[:2]
        GREEN = (0, 220, 100); GRAY = (100, 100, 100); RED = (50, 50, 240); AMBER = (50, 165, 255); DARK = (15, 15, 20)
        cx = w // 2; cy = int(h * 0.38); rx = int(w * 0.17); ry = int(h * 0.24)
        ring_c = RED if status.distance_status == "TOO_CLOSE" else (GRAY if status.distance_status in ("TOO_FAR","NO_FACE") else GREEN)
        ov = frame.copy(); cv2.ellipse(ov, (cx, cy), (rx + 10, ry + 10), 0, 0, 360, ring_c, -1)
        frame = cv2.addWeighted(ov, 0.07, frame, 0.93, 0)
        cv2.ellipse(frame, (cx, cy), (rx, ry), 0, 0, 360, ring_c, 3)
        cv2.putText(frame, "OJOS OK" if status.eyes_detected else "MIRA A LA CAMARA", (cx - 65, cy + ry + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, GREEN if status.eyes_detected else GRAY, 2)
        if status.distance_msg:
            dist_c = GREEN if status.distance_ok else (RED if status.distance_status == "TOO_CLOSE" else GRAY)
            cv2.putText(frame, status.distance_msg, (int(w*0.3), int(h*.68)+24), cv2.FONT_HERSHEY_SIMPLEX, 0.58, dist_c, 2)
        return frame

    def calibrate_baseline(self, bgr_frame: np.ndarray) -> dict:
        h, w   = bgr_frame.shape[:2]
        rgb    = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        baseline = {"timestamp": datetime.datetime.now().isoformat(), "frame_size": [w, h], "face_ref": None}
        face_res = self.face_landmarker.detect(mp_img)
        if face_res.face_landmarks:
            n = face_res.face_landmarks[0][NOSE_TIP]
            baseline["face_ref"] = {"nose_x": round(n.x,3), "nose_y": round(n.y,3)}
        return baseline

    @staticmethod
    def _ear(lms, indices: tuple) -> float:
        def pt(i): return np.array([lms[i].x, lms[i].y])
        p1, p2, p3, p4, p5, p6 = (pt(j) for j in indices)
        return float((np.linalg.norm(p2-p6) + np.linalg.norm(p3-p5)) / (2.0 * np.linalg.norm(p1-p4) + 1e-6))

    def _head_angles(self, lms, iw: int, ih: int) -> tuple:
        def lm(i): p = lms[i]; return np.array([p.x*iw, p.y*ih, p.z*iw])
        nose, le, re = lm(NOSE_TIP), lm(LEFT_EAR_LM), lm(RIGHT_EAR_LM)
        fw = np.linalg.norm(re - le)
        if fw < 1e-6: return 0.0, 0.0
        no = max(-1., min(1., (nose[0] - (le+re)[0]/2) / (fw/2)))
        yaw = math.degrees(math.asin(no))
        fh = np.linalg.norm(lm(FOREHEAD) - lm(CHIN))
        if fh < 1e-6: return yaw, 0.0
        np_ = max(-1., min(1., (nose[1] - (lm(FOREHEAD)[1]+lm(CHIN)[1])/2) / (fh/2)))
        return yaw, math.degrees(math.asin(np_))

    def _smooth(self, hist: list, val: float) -> float:
        hist.append(val); 
        if len(hist) > self._HISTORY_LEN: hist.pop(0)
        return float(np.mean(hist))

    def _analyze_gaze(self, mp_img, iw: int, ih: int) -> tuple:
        res = self.face_landmarker.detect(mp_img)
        if not res.face_landmarks: return GazeResult(0.0, 0.0, "NO_DETECTADO", True, False), []
        lms = res.face_landmarks[0]
        yaw_raw, pitch_raw = self._head_angles(lms, iw, ih)
        yaw_sm = self._smooth(self._yaw_history, yaw_raw)
        pitch_sm = self._smooth(self._pitch_history, pitch_raw)
        yaw_adj = yaw_sm - self._gaze_offset_yaw
        pitch_adj = pitch_sm - self._gaze_offset_pitch
        yaw_extra = abs(self._gaze_offset_yaw) * 0.25
        pitch_extra = abs(self._gaze_offset_pitch) * 0.35
        eff_yaw_warn = max(GAZE_DEADZONE_DEG, self._yaw_warning + yaw_extra)
        eff_pitch_thr = max(GAZE_DEADZONE_DEG, self._pitch_thresh + pitch_extra)
        if abs(yaw_adj) > abs(pitch_adj): direction = "DERECHA" if yaw_adj > 0 else "IZQUIERDA"
        elif abs(pitch_adj) > 5: direction = "ABAJO" if pitch_adj > 0 else "ARRIBA"
        else: direction = "FRENTE"
        susp = abs(yaw_adj) > eff_yaw_warn or abs(pitch_adj) > eff_pitch_thr
        return GazeResult(round(yaw_adj,2), round(pitch_adj,2), direction, susp, True), lms

    def _analyze_fatigue(self, lms: Optional[list], pitch_adj: float, pitch_raw: float) -> FatigueResult:
        if not lms: return FatigueResult(0.0, 0.0, 0.0, False, 0, False, False, 0.0)
        ear_l = self._ear(lms, L_EYE_6); ear_r = self._ear(lms, R_EYE_6); avg = (ear_l + ear_r) / 2.0
        limit = self._base_ear * 0.50 if self._base_ear > 0.0 else EAR_THRESHOLD
        eyes_closing = (avg < limit)
        if eyes_closing: self._low_ear_streak += 1
        else: self._low_ear_streak = max(0, self._low_ear_streak - 2)
        return FatigueResult(avg, ear_l, ear_r, eyes_closing, self._low_ear_streak, self._low_ear_streak >= EAR_FRAMES, pitch_adj < -self._pitch_thresh, min(self._low_ear_streak / max(1, EAR_FRAMES), 1.0))

    def analyze_frame(self, bgr_frame: np.ndarray) -> Optional[SuspicionReport]:
        try:
            now_t = time.time(); fps = int(1.0 / max(now_t - self._last_time, 0.001) + 0.5); self._last_time = now_t
            h, w = bgr_frame.shape[:2]; rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            gaze, face_lms = self._analyze_gaze(mp_img, w, h)
            
            # YOLO Native Resolution (Usa BGR para mantener consistencia en .plot())
            yolo_results_list = self.yolo_model.predict(bgr_frame, classes=[0, 67, 73], verbose=False)
            yolo_results = yolo_results_list[0]
            cell_phone_detected = False; book_detected = False; person_count = 0; yolo_boxes = []
            for box in yolo_results.boxes:
                cls_id = int(box.cls[0].item()); conf = float(box.conf[0].item()); x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                if cls_id == 0 and conf > 0.40: 
                    person_count += 1; name = "Person"
                elif cls_id == 67 and conf > 0.45: cell_phone_detected = True; name = "Cell Phone"
                elif cls_id == 73 and conf > 0.45: book_detected = True; name = "Book"
                else: continue
                yolo_boxes.append({"class": cls_id, "name": name, "conf": conf, "box": [x1, y1, x2, y2]})
            objects = ObjectResult(cell_phone_detected, book_detected, person_count, yolo_boxes, yolo_results)
            self._last_objects = objects

            pitch_raw = gaze.pitch_angle + self._gaze_offset_pitch
            fat = self._analyze_fatigue(face_lms, gaze.pitch_angle, pitch_raw)
            flags = []
            if not gaze.landmarks_detected: flags.append("Cara no detectada")
            elif gaze.suspicion: flags.append(f"Mirada {gaze.gaze_direction}")
            if objects.cell_phone_detected or objects.book_detected: flags.append("Objeto detectado")
            if objects.person_count > 1: flags.append("Multiples personas")
            if fat.drowsy: flags.append("Cansancio")
            
            nf = len(flags)
            
            # ── Lógica del Motor de Reglas (Temporizadores) ──────────────────────
            active_violations = []
            now = time.time()

            # 1. Celular (YOLO)
            if objects.cell_phone_detected:
                if self._cell_phone_start is None: self._cell_phone_start = now
                if (now - self._cell_phone_start) >= CELL_PHONE_LIMIT:
                    active_violations.append("🚨 INFRACCIÓN: USO DE CELULAR")
            else:
                self._cell_phone_start = None

            # 2. Mirada/Distracción
            if gaze.landmarks_detected and gaze.suspicion:
                if self._distraction_start is None: self._distraction_start = now
                if (now - self._distraction_start) >= DISTRACTION_LIMIT:
                    active_violations.append("🚨 INFRACCIÓN: DISTRACCIÓN")
            else:
                self._distraction_start = None

            # 3. Ausencia (No se detecta rostro)
            if not gaze.landmarks_detected:
                if self._absence_start is None: self._absence_start = now
                if (now - self._absence_start) >= ABSENCE_LIMIT:
                    active_violations.append("🚨 INFRACCIÓN: AUSENCIA")
            else:
                self._absence_start = None

            # Imprimir en terminal solo cuando hay cambios en las infracciones
            current_v_set = set(active_violations)
            new_violations = current_v_set - self._last_violations
            for nv in new_violations:
                print(f"{datetime.datetime.now().strftime('%H:%M:%S')} | {nv}")
            self._last_violations = current_v_set

            # Ajuste de nivel y riesgo basado en el Motor de Reglas
            if active_violations:
                level = SuspicionLevel.CRITICO
                self._risk_score = min(1.0, self._risk_score + 0.1)
            elif nf > 0:
                level = SuspicionLevel.ALERTA
                self._risk_score = min(0.7, self._risk_score + 0.05)
            else:
                level = SuspicionLevel.NORMAL
                self._risk_score = max(0.05, self._risk_score - 0.02)

            return SuspicionReport(level, gaze, objects, fat, "; ".join(flags), round(self._risk_score, 2), active_violations, time.time(), fps)
        except Exception as e: print(f"ERR: {e}"); return None

    def draw_overlays(self, bgr_frame: np.ndarray, report: Optional[SuspicionReport]) -> np.ndarray:
        if report is None: return bgr_frame
        frame = bgr_frame.copy()
        if report.objects.raw_results is not None:
            try: frame = report.objects.raw_results.plot()
            except: pass
        color = (0, 200, 100) if report.level == SuspicionLevel.NORMAL else (0, 0, 255)
        cv2.rectangle(frame, (0,0), (frame.shape[1]-1, frame.shape[0]-1), color, 3)
        cv2.putText(frame, f"RIESGO: {report.confidence*100:.0f}%", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        return frame

    def release(self):
        self.face_landmarker.close()
