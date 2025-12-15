import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Clock, Wifi, WifiOff, Zap, Calendar, Plus, Trash2, 
  Sun, Moon, Activity, Timer, LogOut, Loader2, Palette, Power
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    mqtt: any;
  }
}

interface MQTTClient {
  on: (event: string, callback: (...args: any[]) => void) => void;
  subscribe: (topic: string) => void;
  publish: (topic: string, message: string) => void;
}

interface Schedule {
  id: string;
  time: string;
  type: "ON" | "OFF";
  is_active: boolean;
}

type DashboardMode = "compact" | "expanded" | "minimal";

// Color presets with RGB values
const COLOR_PRESETS = [
  // Additional colors
  { label: "1", r: 255, g: 229, b: 0 },   // Kuning cerah
  { label: "2", r: 204, g: 0, b: 255 },   // Purple
  { label: "3", r: 0, g: 178, b: 255 },   // Cyan
  { label: "4", r: 255, g: 51, b: 102 },  // Pink
  { label: "5", r: 255, g: 178, b: 25 },  // Emas hangat
  { label: "6", r: 255, g: 51, b: 0 },    // Orange
  { label: "7", r: 153, g: 102, b: 255 }, // Lavender
  { label: "8", r: 0, g: 229, b: 255 },   // Turquoise
  { label: "9", r: 51, g: 204, b: 76 },   // Tosca
  { label: "10", r: 255, g: 178, b: 76 },  // Peach

  // main colors
  { label: "11", r: 255, g: 255, b: 255 }, // White
  { label: "12", r: 255, g: 0, b: 0 }, // Red
  { label: "13", r: 0, g: 255, b: 0 }, // Green
  { label: "14", r: 0, g: 0, b: 255 }, // Blue

];


const ESP32ControlPanel = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [client, setClient] = useState<MQTTClient | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>("expanded");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [newScheduleTime, setNewScheduleTime] = useState("");
  const [newScheduleType, setNewScheduleType] = useState<"ON" | "OFF">("ON");
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(true);
  
  // RGB State (base values before brightness)
  const [rgb, setRgb] = useState({ r: 0, g: 0, b: 0 });
  const [brightness, setBrightness] = useState(100);

  // Calculate final RGB values with brightness
  const getFinalRgb = (baseRgb: { r: number; g: number; b: number }) => ({
    r: Math.round((baseRgb.r * brightness) / 100),
    g: Math.round((baseRgb.g * brightness) / 100),
    b: Math.round((baseRgb.b * brightness) / 100),
  });

  const BRIGHTNESS_LEVELS = [25, 50, 75, 100];

  // MQTT Configuration
  const broker = "wss://421907ac38364ea6a9e2496b2a3f35a5.s1.eu.hivemq.cloud:8884/mqtt";
  const username = "web_client";
  const password = "Web@2025!123";
  const topicSub = "esp32/status";
  const topicPub = "esp32/led";
  const topicRGB = "esp32/rgb";

  // Check if RGB is configured (at least one channel > 0)
  const isRgbConfigured = () => {
    return rgb.r > 0 || rgb.g > 0 || rgb.b > 0;
  };

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  // Load schedules from database
  useEffect(() => {
    if (user) {
      loadSchedules();
    }
  }, [user]);

  const loadSchedules = async () => {
    if (!user) return;
    
    setIsLoadingSchedules(true);
    try {
      const { data, error } = await supabase
        .from("schedules")
        .select("*")
        .eq("user_id", user.id)
        .order("time", { ascending: true });

      if (error) throw error;
      
      setSchedules(data?.map(s => ({
        id: s.id,
        time: s.time,
        type: s.type as "ON" | "OFF",
        is_active: s.is_active
      })) || []);
    } catch (error) {
      console.error("Error loading schedules:", error);
      toast.error("Failed to load schedules");
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  // MQTT Connection
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/mqtt/dist/mqtt.min.js";
    script.async = true;
    script.onload = () => {
      const mqttClient = window.mqtt.connect(broker, {
        username,
        password,
        clientId: "web-" + Math.random().toString(16).substr(2, 8),
      });

      mqttClient.on("connect", () => {
        setIsConnected(true);
        setStatus("Connected");
        mqttClient.subscribe(topicSub);
        toast.success("Connected to MQTT broker");
      });

      mqttClient.on("reconnect", () => {
        setStatus("Reconnecting...");
        setIsConnected(false);
      });

      mqttClient.on("error", () => {
        setStatus("Connection Error");
        setIsConnected(false);
        toast.error("MQTT connection error");
      });

      mqttClient.on("message", (_topic: string, message: Buffer) => {
        const msg = message.toString();
        setStatus(msg);
      });

      setClient(mqttClient);
    };

    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  // Dark mode handling
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  const sendRGBCommand = (baseRgb: { r: number; g: number; b: number }, brightnessValue: number = brightness) => {
    if (client) {
      const finalRgb = {
        r: Math.round((baseRgb.r * brightnessValue) / 100),
        g: Math.round((baseRgb.g * brightnessValue) / 100),
        b: Math.round((baseRgb.b * brightnessValue) / 100),
      };
      const msg = `RGB,${finalRgb.r},${finalRgb.g},${finalRgb.b}`;
      client.publish(topicRGB, msg);
      setStatus(`Sent: ${msg}`);
    }
  };


  const handleColorPreset = (preset: typeof COLOR_PRESETS[0]) => {
    const newRgb = { r: preset.r, g: preset.g, b: preset.b };
    setRgb(newRgb);
    sendRGBCommand(newRgb);
  };

  const handleBrightnessChange = (level: number) => {
    setBrightness(level);
    sendRGBCommand(rgb, level);
  };

  const handleTurnOff = () => {
    const offRgb = { r: 0, g: 0, b: 0 };
    setRgb(offRgb);
    sendRGBCommand(offRgb, brightness);
    toast.success("All lights turned OFF");
  };

  const addSchedule = async () => {
    if (!newScheduleTime) {
      toast.error("Pilih waktu!");
      return;
    }

    // Only require RGB configuration for ON schedules
    if (newScheduleType === "ON" && !isRgbConfigured()) {
      toast.error("Konfigurasi warna RGB terlebih dahulu! (minimal satu channel > 0)");
      return;
    }

    if (!user) {
      toast.error("Please login first");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("schedules")
        .insert({
          user_id: user.id,
          time: newScheduleTime,
          type: newScheduleType,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      const newSchedule: Schedule = {
        id: data.id,
        time: data.time,
        type: data.type as "ON" | "OFF",
        is_active: data.is_active
      };

      setSchedules([...schedules, newSchedule]);
      
      // Send to ESP32 with final RGB values (with brightness applied)
      const [hour, minute] = newScheduleTime.split(":");
      const finalRgbValues = newScheduleType === "OFF" 
        ? { r: 0, g: 0, b: 0 } 
        : getFinalRgb(rgb);
      const msg = `SCHEDULE,${newScheduleType},${hour},${minute},${finalRgbValues.r},${finalRgbValues.g},${finalRgbValues.b}`;
      if (client) {
        client.publish(topicPub, msg);
      }
      
      const successMsg = newScheduleType === "OFF" 
        ? `Schedule added: ${newScheduleTime} - OFF`
        : `Schedule added: ${newScheduleTime} - ON (Final RGB: ${finalRgbValues.r},${finalRgbValues.g},${finalRgbValues.b})`;
      toast.success(successMsg);
      setNewScheduleTime("");
    } catch (error) {
      console.error("Error adding schedule:", error);
      toast.error("Failed to add schedule");
    }
  };

  const removeSchedule = async (id: string) => {
    try {
      const { error } = await supabase
        .from("schedules")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setSchedules(schedules.filter(s => s.id !== id));
      toast.success("Schedule removed");
    } catch (error) {
      console.error("Error removing schedule:", error);
      toast.error("Failed to remove schedule");
    }
  };

  const toggleScheduleActive = async (id: string) => {
    const schedule = schedules.find(s => s.id === id);
    if (!schedule) return;

    try {
      const { error } = await supabase
        .from("schedules")
        .update({ is_active: !schedule.is_active })
        .eq("id", id);

      if (error) throw error;

      setSchedules(schedules.map(s => 
        s.id === id ? { ...s, is_active: !s.is_active } : s
      ));
    } catch (error) {
      console.error("Error toggling schedule:", error);
      toast.error("Failed to update schedule");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out successfully");
    navigate("/auth");
  };

  const getGridClass = () => {
    switch (dashboardMode) {
      case "compact":
        return "grid-cols-2 md:grid-cols-4 lg:grid-cols-6";
      case "minimal":
        return "grid-cols-1 md:grid-cols-2";
      default:
        return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-500">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-success/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "2s" }} />
      </div>

      <div className="relative z-10 p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <header className="glass-card rounded-3xl p-6 mb-6 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-accent flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110">
                    <Zap className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <div className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-background transition-colors ${
                    isConnected ? "bg-success" : "bg-destructive"
                  }`} />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                    ESP32 Control Panel
                  </h1>
                  <p className="text-muted-foreground flex items-center gap-2 mt-1">
                    <Activity className="h-4 w-4 animate-pulse" />
                    {user.email}
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Dark Mode Toggle */}
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary/50 backdrop-blur">
                  <Sun className="h-4 w-4 text-warning" />
                  <Switch
                    checked={isDarkMode}
                    onCheckedChange={setIsDarkMode}
                  />
                  <Moon className="h-4 w-4 text-primary" />
                </div>

                {/* Dashboard Mode */}
                <div className="flex items-center gap-1 px-2 py-1 rounded-xl bg-secondary/50 backdrop-blur">
                  {(["minimal", "expanded", "compact"] as DashboardMode[]).map((mode) => (
                    <Button
                      key={mode}
                      variant={dashboardMode === mode ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setDashboardMode(mode)}
                      className="text-xs capitalize"
                    >
                      {mode}
                    </Button>
                  ))}
                </div>

                {/* Connection Status */}
                <div className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                  isConnected 
                    ? "bg-success/20 text-success border border-success/30" 
                    : "bg-destructive/20 text-destructive border border-destructive/30"
                }`}>
                  {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                  <span className="font-medium text-sm">
                    {isConnected ? "Online" : "Offline"}
                  </span>
                </div>

                {/* Logout Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  className="rounded-xl border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          </header>

          {/* Main Grid */}
          <div className={`grid ${getGridClass()} gap-4 md:gap-6`}>
            {/* RGB PWM Controller Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2" : dashboardMode === "expanded" ? "md:col-span-1 lg:col-span-1" : ""
            }`} style={{ animationDelay: "0.1s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-pink-500 via-purple-500 to-blue-500 flex items-center justify-center shadow-lg">
                  <Palette className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">RGB PWM Controller</h2>
                  <p className="text-sm text-muted-foreground">Color Presets & Sliders</p>
                </div>
              </div>

              {/* Current Color Preview */}
              <div className="flex items-center justify-center mb-4">
                <div 
                  className="w-16 h-16 rounded-2xl border-2 border-border shadow-lg"
                  style={{ backgroundColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` }}
                />
              </div>

              {/* Color Preset Buttons */}
              <div className="mb-6">
                <p className="text-sm text-muted-foreground mb-3 text-center">Quick Color Presets</p>
                <div className="grid grid-cols-7 gap-2">
                  {COLOR_PRESETS.map((preset, index) => (
                    <button
                      key={index}
                      onClick={() => handleColorPreset(preset)}
                      className="relative w-10 h-10 rounded-lg border-2 border-border hover:border-primary transition-all hover:scale-110 shadow-md"
                      style={{ backgroundColor: `rgb(${preset.r}, ${preset.g}, ${preset.b})` }}
                      title={`RGB(${preset.r}, ${preset.g}, ${preset.b})`}
                    >
                      {preset.label && (
                        <span className={`absolute inset-0 flex items-center justify-center font-bold text-sm ${
                          preset.label === 'W' ? 'text-black' : 'text-black'
                        } drop-shadow-md`}>
                          {preset.label}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* OFF Button */}
                <div className="mt-4">
                  <Button
                    onClick={handleTurnOff}
                    variant="destructive"
                    className="w-full h-12 rounded-xl font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Power className="h-5 w-5 mr-2" />
                    Turn OFF All Lights
                  </Button>
                </div>
              </div>

              {/* Brightness Control */}
              <div className="mt-6 p-4 rounded-xl bg-muted/30 border border-border/50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    Brightness Level
                  </span>
                  <span className="text-sm font-mono text-primary font-bold">
                    {brightness}%
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {BRIGHTNESS_LEVELS.map((level) => (
                    <Button
                      key={level}
                      variant={brightness === level ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleBrightnessChange(level)}
                      className={`h-10 font-bold transition-all ${
                        brightness === level 
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-background" 
                          : "hover:bg-primary/10"
                      }`}
                    >
                      {level}%
                    </Button>
                  ))}
                </div>
                {/* Final RGB Display */}
                <div className="mt-3 p-2 rounded-lg bg-background/50 text-xs text-muted-foreground">
                  <span className="font-medium">Final Output:</span>{" "}
                  <span className="font-mono">
                    R:{getFinalRgb(rgb).r} G:{getFinalRgb(rgb).g} B:{getFinalRgb(rgb).b}
                  </span>
                </div>
              </div>

            </div>

            {/* Add Schedule Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2" : ""
            }`} style={{ animationDelay: "0.2s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-accent to-accent/50 flex items-center justify-center shadow-lg">
                  <Plus className="h-6 w-6 text-accent-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Add Schedule</h2>
                  <p className="text-sm text-muted-foreground">Konfigurasi warna terlebih dahulu</p>
                </div>
              </div>

              {/* RGB Status Indicator */}
              <div className={`mb-4 p-3 rounded-xl border ${
                newScheduleType === "OFF"
                  ? "bg-muted/50 border-border text-muted-foreground"
                  : isRgbConfigured() 
                    ? "bg-success/10 border-success/30 text-success" 
                    : "bg-warning/10 border-warning/30 text-warning"
              }`}>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    {newScheduleType === "OFF"
                      ? "Mode OFF: Warna tidak diperlukan (semua lampu mati)"
                      : isRgbConfigured() 
                        ? `Base RGB(${rgb.r}, ${rgb.g}, ${rgb.b}) @ ${brightness}%`
                        : "⚠️ Pilih warna RGB terlebih dahulu!"
                    }
                  </div>
                  {newScheduleType !== "OFF" && isRgbConfigured() && (
                    <div className="text-xs opacity-80 ml-6">
                      Final: RGB({getFinalRgb(rgb).r}, {getFinalRgb(rgb).g}, {getFinalRgb(rgb).b})
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    type="time"
                    value={newScheduleTime}
                    onChange={(e) => setNewScheduleTime(e.target.value)}
                    className="pl-12 h-14 bg-secondary/50 border-border/50 rounded-2xl text-foreground text-lg"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={newScheduleType === "ON" ? "default" : "outline"}
                    onClick={() => setNewScheduleType("ON")}
                    className={`h-12 rounded-xl font-semibold transition-all ${
                      newScheduleType === "ON" 
                        ? "bg-success text-success-foreground" 
                        : "border-success/30 text-success hover:bg-success/10"
                    }`}
                  >
                    Turn ON
                  </Button>
                  <Button
                    variant={newScheduleType === "OFF" ? "default" : "outline"}
                    onClick={() => setNewScheduleType("OFF")}
                    className={`h-12 rounded-xl font-semibold transition-all ${
                      newScheduleType === "OFF" 
                        ? "bg-destructive text-destructive-foreground" 
                        : "border-destructive/30 text-destructive hover:bg-destructive/10"
                    }`}
                  >
                    Turn OFF
                  </Button>
                </div>

                <Button
                  onClick={addSchedule}
                  disabled={newScheduleType === "ON" && !isRgbConfigured()}
                  className={`w-full h-12 sm:h-14 rounded-xl sm:rounded-2xl font-bold text-sm sm:text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] ${
                    newScheduleType === "OFF" || isRgbConfigured()
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2" />
                  <span className="truncate">
                    {newScheduleType === "OFF" 
                      ? "Save Schedule (OFF)" 
                      : `Save Schedule (RGB: ${rgb.r},${rgb.g},${rgb.b})`
                    }
                  </span>
                </Button>
              </div>
            </div>

            {/* Schedules List Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2 md:col-span-4 lg:col-span-2" : dashboardMode === "expanded" ? "md:col-span-2 lg:col-span-2" : ""
            }`} style={{ animationDelay: "0.25s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-warning to-warning/50 flex items-center justify-center shadow-lg">
                  <Timer className="h-6 w-6 text-warning-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Active Schedules</h2>
                  <p className="text-sm text-muted-foreground">{schedules.length} timers configured</p>
                </div>
              </div>

              <div className="space-y-3 max-h-80 overflow-y-auto custom-scrollbar">
                {isLoadingSchedules ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : schedules.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No schedules yet</p>
                    <p className="text-sm">Konfigurasi warna lalu tambahkan schedule</p>
                  </div>
                ) : (
                  schedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className={`flex items-center justify-between p-4 rounded-2xl transition-all ${
                        schedule.is_active
                          ? "bg-secondary/80 border border-border/50"
                          : "bg-secondary/30 border border-border/20 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                          schedule.type === "ON"
                            ? "bg-success/20 text-success"
                            : "bg-destructive/20 text-destructive"
                        }`}>
                          <Clock className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-bold text-lg text-foreground">{schedule.time}</p>
                          <p className={`text-sm font-medium ${
                            schedule.type === "ON" ? "text-success" : "text-destructive"
                          }`}>
                            Turn {schedule.type}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={schedule.is_active}
                          onCheckedChange={() => toggleScheduleActive(schedule.id)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSchedule(schedule.id)}
                          className="h-10 w-10 rounded-xl text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Status Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2" : ""
            }`} style={{ animationDelay: "0.3s" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-secondary to-secondary/50 flex items-center justify-center shadow-lg">
                  <Activity className="h-6 w-6 text-secondary-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Status</h2>
                  <p className="text-sm text-muted-foreground">MQTT Messages</p>
                </div>
              </div>

              <div className={`p-4 rounded-2xl text-center text-lg font-mono transition-all ${
                isConnected
                  ? "bg-success/10 text-success border border-success/30"
                  : "bg-destructive/10 text-destructive border border-destructive/30"
              }`}>
                {status}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ESP32ControlPanel;
