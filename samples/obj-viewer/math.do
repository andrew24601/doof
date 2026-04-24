export import function sin(x: float): float from "<cmath>" as std::sin
export import function cos(x: float): float from "<cmath>" as std::cos
export import function sqrt(x: float): float from "<cmath>" as std::sqrt
export import function abs(x: float): float from "<cmath>" as std::fabs
export import function min(a: float, b: float): float from "<algorithm>" as std::min
export import function max(a: float, b: float): float from "<algorithm>" as std::max
export import function clamp(x: float, lo: float, hi: float): float from "<algorithm>" as std::clamp

export const PI: float = 3.1415927f