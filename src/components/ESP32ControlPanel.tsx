import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Power, Clock, Wifi, WifiOff, Zap, Calendar, Plus, Trash2, 
  Sun, Moon, Activity, Timer, LogOut, Loader2, Palette, Gauge
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    mqtt: any;
    iro: any;
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

const V_SUPPLY = 220;

const ESP32ControlPanel = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const colorPickerInstance = useRef<any>(null);
  const isFromPicker = useRef(false);
  
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [ledState, setLedState] = useState<"ON" | "OFF" | null>(null);
  const [client, setClient] = useState<MQTTClient | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>("expanded");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [newScheduleTime, setNewScheduleTime] = useState("");
  const [newScheduleType, setNewScheduleType] = useState<"ON" | "OFF">("ON");
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(true);
  
  // RGB State
  const [rgb, setRgb] = useState({ r: 0, g: 0, b: 0 });

  // MQTT Configuration
  const broker = "wss://73d4cffe19e94407ae5266f86d9731aa.s1.eu.hivemq.cloud:8884/mqtt";
  const username = "web_client";
  const password = "Web@2025!123";
  const topicSub = "esp32/status";
  const topicPub = "esp32/led";
  const topicRGB = "esp32/rgb";

  // Calculate monitor values
  const calculateMonitor = (value: number) => {
    const duty = (value / 255) * 100;
    const voltage = (duty / 100) * V_SUPPLY;
    return { duty, voltage, pwm: value };
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

  // Load iro.js color picker
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@jaames/iro@5";
    script.async = true;
    script.onload = () => {
      if (colorPickerRef.current && window.iro && !colorPickerInstance.current) {
        colorPickerInstance.current = new window.iro.ColorPicker(colorPickerRef.current, {
          width: 180,
          color: { r: rgb.r, g: rgb.g, b: rgb.b },
          borderWidth: 2,
          borderColor: "#333"
        });

        colorPickerInstance.current.on("color:change", (color: any) => {
          isFromPicker.current = true;
          const newRgb = {
            r: Math.round(color.rgb.r),
            g: Math.round(color.rgb.g),
            b: Math.round(color.rgb.b)
          };
          setRgb(newRgb);
          sendRGBCommand(newRgb);
          isFromPicker.current = false;
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

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
        if (msg === "ON" || msg === "OFF") {
          setLedState(msg);
        }
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

  const sendCommand = (cmd: "ON" | "OFF") => {
    if (client) {
      client.publish(topicRGB, cmd);
      setLedState(cmd);
      setStatus(`Sent: ${cmd}`);
      toast.success(`LED turned ${cmd}`);
    }
  };

  const sendRGBCommand = (rgbValues: { r: number; g: number; b: number }) => {
    if (client) {
      const msg = `RGB,${rgbValues.r},${rgbValues.g},${rgbValues.b}`;
      client.publish(topicRGB, msg);
      setStatus(`Sent: ${msg}`);
    }
  };

  const handleSliderChange = (color: "r" | "g" | "b", value: number) => {
    const newRgb = { ...rgb, [color]: value };
    setRgb(newRgb);
    
    // Update color picker if not triggered by picker
    if (colorPickerInstance.current && !isFromPicker.current) {
      colorPickerInstance.current.color.rgb = { r: newRgb.r, g: newRgb.g, b: newRgb.b };
    }
    
    sendRGBCommand(newRgb);
  };

  const addSchedule = async () => {
    if (!newScheduleTime) {
      toast.error("Please select a time!");
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
      
      // Send to ESP32 with RGB values
      const [hour, minute] = newScheduleTime.split(":");
      const msg = `SCHEDULE,${newScheduleType},${hour},${minute},${rgb.r},${rgb.g},${rgb.b}`;
      if (client) {
        client.publish(topicRGB, msg);
      }
      
      toast.success(`Schedule added: ${newScheduleTime} - ${newScheduleType}`);
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

  const redMonitor = calculateMonitor(rgb.r);
  const greenMonitor = calculateMonitor(rgb.g);
  const blueMonitor = calculateMonitor(rgb.b);

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
                  <p className="text-sm text-muted-foreground">Color Wheel & Sliders</p>
                </div>
              </div>

              {/* Color Picker */}
              <div className="flex justify-center mb-6">
                <div ref={colorPickerRef} id="colorWheel"></div>
              </div>

              {/* RGB Sliders */}
              <div className="space-y-4">
                {/* Red Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-red-500">Red</span>
                    <span className="text-sm font-mono text-muted-foreground">{rgb.r}</span>
                  </div>
                  <Slider
                    value={[rgb.r]}
                    onValueChange={(value) => handleSliderChange("r", value[0])}
                    max={255}
                    step={1}
                    className="[&_[role=slider]]:bg-red-500 [&_[role=slider]]:border-red-600 [&_.bg-primary]:bg-red-500"
                  />
                </div>

                {/* Green Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-green-500">Green</span>
                    <span className="text-sm font-mono text-muted-foreground">{rgb.g}</span>
                  </div>
                  <Slider
                    value={[rgb.g]}
                    onValueChange={(value) => handleSliderChange("g", value[0])}
                    max={255}
                    step={1}
                    className="[&_[role=slider]]:bg-green-500 [&_[role=slider]]:border-green-600 [&_.bg-primary]:bg-green-500"
                  />
                </div>

                {/* Blue Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-blue-500">Blue</span>
                    <span className="text-sm font-mono text-muted-foreground">{rgb.b}</span>
                  </div>
                  <Slider
                    value={[rgb.b]}
                    onValueChange={(value) => handleSliderChange("b", value[0])}
                    max={255}
                    step={1}
                    className="[&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-blue-600 [&_.bg-primary]:bg-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Signal Monitor Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2" : ""
            }`} style={{ animationDelay: "0.15s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-lg">
                  <Gauge className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Signal Monitor</h2>
                  <p className="text-sm text-muted-foreground">V<sub>sup</sub> = {V_SUPPLY} V</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Red Monitor */}
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-red-500">Red Channel</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">Voltage</div>
                      <div className="font-mono text-foreground">{redMonitor.voltage.toFixed(2)} V</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">Duty</div>
                      <div className="font-mono text-foreground">{redMonitor.duty.toFixed(1)}%</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">PWM</div>
                      <div className="font-mono text-foreground">{redMonitor.pwm}</div>
                    </div>
                  </div>
                </div>

                {/* Green Monitor */}
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-green-500">Green Channel</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">Voltage</div>
                      <div className="font-mono text-foreground">{greenMonitor.voltage.toFixed(2)} V</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">Duty</div>
                      <div className="font-mono text-foreground">{greenMonitor.duty.toFixed(1)}%</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">PWM</div>
                      <div className="font-mono text-foreground">{greenMonitor.pwm}</div>
                    </div>
                  </div>
                </div>

                {/* Blue Monitor */}
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-blue-500">Blue Channel</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">Voltage</div>
                      <div className="font-mono text-foreground">{blueMonitor.voltage.toFixed(2)} V</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">Duty</div>
                      <div className="font-mono text-foreground">{blueMonitor.duty.toFixed(1)}%</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background/50">
                      <div className="text-muted-foreground">PWM</div>
                      <div className="font-mono text-foreground">{blueMonitor.pwm}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* LED Control Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2" : dashboardMode === "expanded" ? "md:col-span-1 lg:col-span-1" : ""
            }`} style={{ animationDelay: "0.2s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center shadow-lg">
                  <Power className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">LED Control</h2>
                  <p className="text-sm text-muted-foreground">Manual Override</p>
                </div>
              </div>
              
              {/* Big LED Indicator */}
              <div className="flex justify-center mb-6">
                <div className={`relative h-32 w-32 rounded-full transition-all duration-700 ${
                  ledState === "ON" 
                    ? "bg-gradient-to-br from-success via-success to-success/50 shadow-[0_0_60px_rgba(34,197,94,0.5)]" 
                    : "bg-gradient-to-br from-muted via-muted to-muted/50"
                }`}>
                  <div className="absolute inset-4 rounded-full bg-gradient-to-br from-white/20 to-transparent" />
                  {ledState === "ON" && (
                    <>
                      <div className="absolute inset-0 rounded-full bg-success animate-ping opacity-20" />
                      <div className="absolute inset-0 rounded-full bg-success/30 animate-pulse" />
                    </>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-2xl font-bold ${ledState === "ON" ? "text-success-foreground" : "text-muted-foreground"}`}>
                      {ledState || "---"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => sendCommand("ON")}
                  className={`h-14 text-lg font-bold rounded-2xl transition-all duration-300 transform hover:scale-105 ${
                    ledState === "ON" 
                      ? "bg-success text-success-foreground shadow-lg shadow-success/30" 
                      : "bg-success/20 text-success hover:bg-success hover:text-success-foreground border border-success/30"
                  }`}
                >
                  <Power className="h-5 w-5 mr-2" />
                  ON
                </Button>
                <Button
                  onClick={() => sendCommand("OFF")}
                  className={`h-14 text-lg font-bold rounded-2xl transition-all duration-300 transform hover:scale-105 ${
                    ledState === "OFF" 
                      ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30" 
                      : "bg-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground border border-destructive/30"
                  }`}
                >
                  <Power className="h-5 w-5 mr-2" />
                  OFF
                </Button>
              </div>
            </div>

            {/* Add Schedule Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2" : ""
            }`} style={{ animationDelay: "0.25s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-accent to-accent/50 flex items-center justify-center shadow-lg">
                  <Plus className="h-6 w-6 text-accent-foreground" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Add Schedule</h2>
                  <p className="text-sm text-muted-foreground">R,G,B akan aktif</p>
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
                  className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg transition-all transform hover:scale-[1.02]"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Save Schedule
                </Button>
              </div>
            </div>

            {/* Schedules List Card */}
            <div className={`glass-card rounded-3xl p-6 animate-fade-in ${
              dashboardMode === "compact" ? "col-span-2 md:col-span-4 lg:col-span-2" : dashboardMode === "expanded" ? "md:col-span-2 lg:col-span-2" : ""
            }`} style={{ animationDelay: "0.3s" }}>
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
                    <p className="text-sm">Add a schedule to automate your LED</p>
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
            }`} style={{ animationDelay: "0.35s" }}>
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
