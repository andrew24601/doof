export const PI: float = 3.14159f

export import function sin(x: float): float from "<cmath>" as std::sin
export import function cos(x: float): float from "<cmath>" as std::cos
export import function tan(x: float): float from "<cmath>" as std::tan
export import function sqrt(x: float): float from "<cmath>" as std::sqrt
export import function abs(x: float): float from "<cmath>" as std::fabs
export import function floor(x: float): float from "<cmath>" as std::floor
export import function ceil(x: float): float from "<cmath>" as std::ceil
export import function fmod(x: float, y: float): float from "<cmath>" as std::fmod
export import function min(a: float, b: float): float from "<algorithm>" as std::min
export import function max(a: float, b: float): float from "<algorithm>" as std::max
export import function clamp(x: float, lo: float, hi: float): float from "<algorithm>" as std::clamp